"use strict";

/**
 * Shared batch-aware stock helpers. All stock mutations in the app funnel
 * through these so the invariant `Products.qty = SUM(ProductBatches.qty)`
 * and `Products.expire_date = soonest batch expire_date (qty > 0)` holds.
 */
const { Product, ProductBatch } = require("../../models");
const { Op } = require("sequelize");

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

module.exports = {
  syncProductFromBatches,
  addStockToBatch,
  deductStockFifo,
  restoreStockToBatch,
  getSoonestBatch,
  isExpired,
};
