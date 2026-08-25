/**
 * Shared batch-aware stock helpers. All stock mutations in the app funnel
 * through these so the invariant `Products.qty = SUM(ProductBatches.qty)`
 * and `Products.expire_date = soonest batch expire_date (qty > 0)` holds.
 */
const { Product, ProductBatch, Inventory, StockMovement, OrderDetailBatch } = require("../../models");
const { Op } = require("sequelize");

// ─── EXISTING FUNCTIONS (unchanged) ────────────────────────

/**
 * Recalculate Products.qty (= SUM of all batch qty) and Products.expire_date
 * (= soonest batch with qty > 0, or null). Must run after any batch insert /
 * update / delete. Pass `transaction` when called from within one.
 */
async function syncProductFromBatches(productId, { transaction } = {}) {
  const batches = await ProductBatch.findAll({
    where: { productId, qty: { [Op.gt]: 0 } },
    order: [["expireDate", "ASC NULLS LAST"]],
    transaction,
  });

  const totalQty = batches.reduce((sum, b) => sum + Number(b.qty), 0);
  const soonestExpire = batches.length > 0 ? batches[0].expireDate : null;

  await Product.update(
    { qty: totalQty, expireDate: soonestExpire },
    { where: { id: productId }, transaction }
  );

  return { totalQty, soonestExpire };
}

/**
 * Resolve the "soonest qty>0 batch" for a product — the SAME lookup that
 * syncProductFromBatches uses to derive Product.expireDate. Callers should use
 * this instead of trusting a possibly-stale Product.expireDate when batches may
 * have changed since the last sync. Returns the batch row or null.
 */
async function getSoonestBatch(productId, { transaction } = {}) {
  return ProductBatch.findOne({
    where: { productId, qty: { [Op.gt]: 0 } },
    order: [["expireDate", "ASC NULLS LAST"]],
    transaction,
  });
}

/**
 * A product is "expired" when its soonest sellable batch (qty > 0) has an
 * expire_date strictly before today. Batches with no expiry are never expired,
 * and batches expiring today are still sellable. The check is derived live from
 * ProductBatches so it never depends on a stale Product.expireDate cache.
 *
 * @returns {Promise<boolean>}
 */
async function isExpired(productId, { transaction } = {}) {
  const soonest = await getSoonestBatch(productId, { transaction });

  // No sellable batch (out of stock) or a batch with no expiry → not expired.
  if (!soonest || !soonest.expireDate) return false;

  const expire = new Date(`${soonest.expireDate}T00:00:00`);
  const today  = new Date();
  today.setHours(0, 0, 0, 0);

  return expire < today;
}

/**
 * Add received stock as a new batch (e.g. receiving goods, stock-in, or the
 * initial stock when creating a product). Optionally carries expiry, lot
 * number, and per-batch cost price.
 */
async function addStockToBatch(productId, { qty, expireDate = null, batchNumber = null, costPrice = null } = {}, { transaction } = {}) {
  const q = Number(qty);
  if (!Number.isInteger(q) || q <= 0) {
    throw new Error("qty must be a positive integer");
  }

  const created = await ProductBatch.create(
    {
      productId,
      qty: q,
      expireDate: expireDate || null,
      batchNumber: batchNumber || null,
      costPrice: costPrice != null && costPrice !== "" ? costPrice : null,
    },
    { transaction }
  );

  await syncProductFromBatches(productId, { transaction });

  return created;
}

/**
 * FIFO / FEFO deduction: subtract `qty` from the soonest-expiring batches
 * first, spilling into later batches when an earlier one runs out. Throws if
 * total available stock is insufficient.
 */
async function deductStockFifo(productId, qty, { transaction } = {}) {
  const remainingToDeduct = Number(qty);
  if (!Number.isInteger(remainingToDeduct) || remainingToDeduct <= 0) {
    throw new Error("qty must be a positive integer");
  }

  const batches = await ProductBatch.findAll({
    where: { productId, qty: { [Op.gt]: 0 } },
    order: [["expireDate", "ASC NULLS LAST"]],
    transaction,
  });

  let remaining = remainingToDeduct;
  for (const batch of batches) {
    if (remaining <= 0) break;
    const take = Math.min(Number(batch.qty), remaining);
    await batch.update({ qty: Number(batch.qty) - take }, { transaction });
    remaining -= take;
  }

  if (remaining > 0) {
    throw new Error(`Insufficient stock for product id=${productId}`);
  }

  await syncProductFromBatches(productId, { transaction });
}

/**
 * Return stock to inventory when an order is cancelled. Adds the quantity
 * back to the batch that FIFO would have deducted next (earliest expire_date),
 * or creates a new batch with no expiry when none exists.
 */
async function restoreStockToBatch(productId, qty, { transaction } = {}) {
  const q = Number(qty);
  if (!Number.isInteger(q) || q <= 0) {
    throw new Error("qty must be a positive integer");
  }

  const target = await ProductBatch.findOne({
    where: { productId, qty: { [Op.gt]: 0 } },
    order: [["expireDate", "ASC NULLS LAST"]],
    transaction,
  });

  if (target) {
    await target.update({ qty: Number(target.qty) + q }, { transaction });
  } else {
    await ProductBatch.create(
      {
        productId,
        qty: q,
        expireDate: null,
        batchNumber: null,
        costPrice: null,
      },
      { transaction }
    );
  }

  await syncProductFromBatches(productId, { transaction });
}

// ─── NEW: Stock Movement ────────────────────────────────────

/**
 * Create an immutable StockMovement record. Does NOT change any stock —
 * the caller must update ProductBatch / Inventory separately within the
 * same transaction.
 *
 * @param {number} productId
 * @param {number} batchId
 * @param {string} type — PURCHASE | SALE | RETURN | ADJUSTMENT | DAMAGE | EXPIRED
 * @param {number} quantity — positive for increase, negative for decrease
 * @param {object} [opts]
 * @param {number} [opts.userId] — ID of the cashier/admin who caused the movement
 * @param {string} [opts.referenceId] — orderId, orderDetailId, etc.
 * @param {string} [opts.reason]
 * @param {object} [opts.transaction]
 */
async function createStockMovement(productId, batchId, type, quantity, { userId = null, referenceId = null, reason = null, transaction } = {}) {
  return StockMovement.create(
    {
      productId,
      batchId,
      type,
      quantity: Number(quantity),
      userId: userId || null,
      referenceId: referenceId || null,
      reason: reason || null,
    },
    { transaction }
  );
}

// ─── NEW: Inventory helpers ─────────────────────────────────

/**
 * Ensure an Inventory row exists for a given batch. If it already exists,
 * return the existing row. Must be called after a ProductBatch is created.
 */
async function ensureInventoryForBatch(batchId, { transaction } = {}) {
  let inv = await Inventory.findOne({ where: { batchId }, transaction });
  if (!inv) {
    inv = await Inventory.create({ batchId, qty: 0, availableQty: 0, reservedQty: 0 }, { transaction });
  }
  return inv;
}

/**
 * Update Inventory quantities for a batch. Call this after every
 * ProductBatch.qty change to keep the Inventory table in sync.
 *
 * @param {number} batchId
 * @param {number} deltaQty — change in total qty (positive or negative)
 * @param {number} [deltaReserved] — change in reserved qty (default 0)
 * @param {object} [opts]
 * @param {object} [opts.transaction]
 */
async function updateInventoryForBatch(batchId, deltaQty, deltaReserved = 0, { transaction } = {}) {
  const inv = await ensureInventoryForBatch(batchId, { transaction });

  const newQty         = Number(inv.qty)         + Number(deltaQty);
  const newReserved    = Number(inv.reservedQty)  + Number(deltaReserved);
  const newAvailable   = Math.max(0, newQty - newReserved);

  await inv.update(
    {
      qty:          newQty,
      reservedQty:  newReserved,
      availableQty: newAvailable,
    },
    { transaction }
  );

  return inv;
}

// ─── NEW: Batch allocation for order details ────────────────

/**
 * Determine which batches to consume for a given order detail line using
 * the existing FIFO/FEFO logic, create OrderDetailBatch records, reduce
 * ProductBatch quantities, update Inventory, and create SALE movement records.
 *
 * All operations run inside the caller's transaction.
 *
 * @param {number} orderDetailId
 * @param {number} productId
 * @param {number} qty — total quantity needed
 * @param {object} [opts]
 * @param {number} [opts.userId] — cashier/admin who caused this movement
 * @param {object} [opts.transaction]
 * @returns {Promise<Array>} — created OrderDetailBatch rows
 */
async function allocateBatchesToOrderDetail(orderDetailId, productId, qty, { userId = null, transaction } = {}) {
  const remaining = Number(qty);
  if (!Number.isInteger(remaining) || remaining <= 0) {
    throw new Error("qty must be a positive integer");
  }

  // Reuse existing FIFO/FEFO ordering to pick batches
  const batches = await ProductBatch.findAll({
    where: { productId, qty: { [Op.gt]: 0 } },
    order: [["expireDate", "ASC NULLS LAST"], ["createdAt", "ASC"]],
    transaction,
  });

  if (batches.length === 0) {
    throw new Error(`No batches available for product id=${productId}`);
  }

  const allocations = [];
  let toDeduct = remaining;

  for (const batch of batches) {
    if (toDeduct <= 0) break;
    const take = Math.min(Number(batch.qty), toDeduct);

    // 1. Reduce ProductBatch.qty
    await batch.update({ qty: Number(batch.qty) - take }, { transaction });

    // 2. Update Inventory
    await updateInventoryForBatch(batch.id, -take, 0, { transaction });

    // 3. Create OrderDetailBatch record
    const odb = await OrderDetailBatch.create(
      {
        orderDetailId,
        batchId:   batch.id,
        quantity:  take,
      },
      { transaction }
    );
    allocations.push(odb);

    // 4. Create StockMovement record
    await createStockMovement(
      productId,
      batch.id,
      "SALE",
      -take,
      {
        userId,
        referenceId: `orderDetail:${orderDetailId}`,
        reason:      `Order detail ${orderDetailId}`,
        transaction,
      }
    );

    toDeduct -= take;
  }

  if (toDeduct > 0) {
    throw new Error(`Insufficient stock for product id=${productId}. Short by ${toDeduct}`);
  }

  // 5. Re-sync Product.qty from batches
  await syncProductFromBatches(productId, { transaction });

  return allocations;
}

// ─── NEW: Return processing ────────────────────────────────

/**
 * Process a product return: restore stock to the original batch(es) used
 * in the order, update Inventory, and create RETURN movement records.
 *
 * If OrderDetailBatch records exist, stock is returned to those exact batches.
 * Otherwise, falls back to FIFO restore (soonest-expiring batch).
 *
 * @param {number} orderDetailId
 * @param {number} productId
 * @param {number} qty — quantity being returned
 * @param {object} [opts]
 * @param {number} [opts.userId] — cashier/admin who processed this return
 * @param {object} [opts.transaction]
 * @returns {Promise<Array>} — created StockMovement rows
 */
async function processReturn(orderDetailId, productId, qty, { userId = null, transaction } = {}) {
  const returnQty = Number(qty);
  if (!Number.isInteger(returnQty) || returnQty <= 0) {
    throw new Error("qty must be a positive integer");
  }

  // Try to find the original batch allocations for this order detail
  const originalAllocations = await OrderDetailBatch.findAll({
    where: { orderDetailId },
    transaction,
  });

  const movements = [];
  let remaining = returnQty;

  if (originalAllocations.length > 0) {
    // Return to the exact original batches (preserves batch traceability)
    for (const alloc of originalAllocations) {
      if (remaining <= 0) break;
      const batch = await ProductBatch.findByPk(alloc.batchId, { transaction });
      if (!batch) continue;

      const add = Math.min(remaining, alloc.quantity); // cap at original allocation
      await batch.update({ qty: Number(batch.qty) + add }, { transaction });
      await updateInventoryForBatch(batch.id, add, 0, { transaction });

      const mv = await createStockMovement(
        productId,
        batch.id,
        "RETURN",
        add,
        {
          userId,
          referenceId: `orderDetail:${orderDetailId}`,
          reason:      `Return from order detail ${orderDetailId}`,
          transaction,
        }
      );
      movements.push(mv);
      remaining -= add;
    }
  } else {
    // No OrderDetailBatch records — fall back to FIFO (soonest batch)
    const target = await ProductBatch.findOne({
      where: { productId, qty: { [Op.gte]: 0 } },
      order: [["expireDate", "ASC NULLS LAST"], ["createdAt", "ASC"]],
      transaction,
    });

    if (target) {
      await target.update({ qty: Number(target.qty) + returnQty }, { transaction });
      await updateInventoryForBatch(target.id, returnQty, 0, { transaction });
    } else {
      // No batch at all — create a new one
      await ProductBatch.create(
        {
          productId,
          qty:         returnQty,
          expireDate:  null,
          batchNumber: null,
          costPrice:   null,
        },
        { transaction }
      );
    }

    const mv = await createStockMovement(
      productId,
      target ? target.id : 0,
      "RETURN",
      returnQty,
      {
        userId,
        referenceId: `orderDetail:${orderDetailId}`,
        reason:      `Return from order detail ${orderDetailId} (no batch traceability)`,
        transaction,
      }
    );
    movements.push(mv);
  }

  // Re-sync Product.qty
  await syncProductFromBatches(productId, { transaction });

  return movements;
}

module.exports = {
  syncProductFromBatches,
  addStockToBatch,
  deductStockFifo,
  restoreStockToBatch,
  getSoonestBatch,
  isExpired,
  // New exports
  createStockMovement,
  ensureInventoryForBatch,
  updateInventoryForBatch,
  allocateBatchesToOrderDetail,
  processReturn,
};
