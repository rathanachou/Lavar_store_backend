const express = require("express");
const { Order, Customer, OrderDetail, Product, Payment, User, Return, OrderDetailBatch, ProductBatch } = require("../../models");
const { sendTelegramMessage, formatOrderMessage } = require("../utils/telegram");
const { sequelize } = require("../../models");
const { deductStockFifo, restoreStockToBatch, isExpired, allocateBatchesToOrderDetail, processReturn } = require("../utils/batchStock");
const { Op } = require("sequelize");
const { authenticate } = require("../middlewares/authMiddleware");
const requireRole = require("../middlewares/requireRole");

const router = express.Router();

// ─── POST: Create Order (PENDING — no stock deduction) ───
router.post("/", async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { items, discount, currency } = req.body;

    // Currency the POS charged the customer in. "USD" (default) keeps the USD
    // ledger; "KHR" also persists the Riel amount paid so the Daily Report can
    // show it. Reject anything other than USD/KHR to avoid junk values.
    const paidCurrency = currency === "KHR" ? "KHR" : "USD";
    const khrRate      = Number(process.env.ABA_PAYWAY_KHR_RATE) || 4100;

    if (!items || items.length === 0) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: "Order items are required" });
    }

    const orderDetailsData = [];
    let subtotal = 0;               // sum of line amounts AFTER per-product discount
    let productDiscountTotal = 0;   // sum of per-product (near-expiry) discounts
    let total    = 0;               // final total after per-product + manual discount

    for (const item of items) {
      const productId = Number(item.productId);
      const qty       = Number(item.qty);

      const product = await Product.findByPk(productId, { transaction });

      if (!product) {
        await transaction.rollback();
        return res.status(404).json({ success: false, message: `Product id=${productId} not found` });
      }

      //  Block expired products — checked live against the soonest qty>0 batch
      //  (same logic as syncProductFromBatches) so batches changed since the last
      //  sync can't slip a stale Product.expireDate through.
      if (await isExpired(product.id, { transaction })) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Product "${product.name}" is expired and cannot be sold`,
        });
      }

      //  Check stock but do NOT deduct yet
      if (product.qty < qty) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Stock  "${product.name}". មាន: ${product.qty}, : ${qty}`,
        });
      }

      const productPrice = Number(product.price);
      const rawAmount    = productPrice * qty;

      // Apply near-expiry product discount (discount_percent) if present
      const percent = Number(product.discountPercent) || 0;
      const amount  = percent > 0 ? rawAmount * (1 - percent / 100) : rawAmount;
      // Persist the per-line discount so receipts/reports can surface it.
      const lineDiscount = Math.max(0, rawAmount - amount);

      subtotal += amount;
      productDiscountTotal += lineDiscount;
      orderDetailsData.push({ productId, productName: product.name, productPrice, qty, amount, discount: lineDiscount });
    }

    // Manual flat discount (from checkout) applies on top of per-product discounts.
    // Order.discount holds the TOTAL discount (manual + per-product) so reports
    // summing the column reflect the full amount customers saved.
    const manualDiscount = Number(discount) || 0;
    const totalDiscount  = manualDiscount + productDiscountTotal;
    total = Math.max(0, subtotal - manualDiscount);

    const orderNumber  = generateInvoiceNumber();
    const createdOrder = await Order.create(
      {
        customerId: null,
        userId:     req.user ? req.user.id : null,
        orderNumber,
        total:     Number(total.toFixed(2)),
        discount:  Number(totalDiscount.toFixed(2)),
        status:    "pending",
        orderDate: new Date(),
        location:  "N/A",
        currency:  paidCurrency,
        // Convert the final (post-discount) total to whole Riel when charged
        // in KHR, using the same rate the ABA PayWay charge uses, so the Daily
        // Report can sum this column directly.
        amountKhr: paidCurrency === "KHR"
          ? Math.round(Number(total) * khrRate)
          : null,
      },
      { transaction }
    );

    const detailsToInsert = orderDetailsData.map((d) => ({
      orderId:      createdOrder.id,
      productId:    d.productId,
      productName:  d.productName,
      productPrice: d.productPrice,
      qty:          d.qty,
      amount:       d.amount,
      discount:     d.discount,
    }));

    await OrderDetail.bulkCreate(detailsToInsert, { transaction, validate: true });
    await transaction.commit();

    const createdWithDetails = await Order.findByPk(createdOrder.id, {
      include: [{ model: OrderDetail, as: "orderDetails" }],
    });

    res.status(201).json({
      success: true,
      message: "Order created — awaiting payment",
      data: createdWithDetails,
    });

  } catch (error) {
    await transaction.rollback();
    console.error("❌ Create order error:", error.message);
    res.status(500).json({
      success: false,
      message: error.message,
      details: error.errors?.map((e) => ({ field: e.path, message: e.message })),
    });
  }
});


router.post("/:id/confirm", async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { id } = req.params;

    const order = await Order.findByPk(id, {
      include: [{ model: OrderDetail, as: "orderDetails" }],
      transaction,
    });

    if (!order) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: `Order id=${id} not found` });
    }

    if (order.status === "completed") {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: "Order already completed" });
    }

    //  Deduct stock only after payment confirmed.
    //  allocateBatchesToOrderDetail handles FIFO selection, OrderDetailBatch
    //  creation, ProductBatch.qty reduction, Inventory update, and SALE
    //  movement creation — all inside this transaction.
    for (const detail of order.orderDetails) {
      const product = await Product.findByPk(detail.productId, { transaction });

      if (!product) {
        await transaction.rollback();
        return res.status(404).json({ success: false, message: `Product id=${detail.productId} not found` });
      }

      //  Block expired products at confirm time too (defense in depth: stock was
      //  checked but not deducted at order creation, so batches may have changed).
      if (await isExpired(detail.productId, { transaction })) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Product "${product.name}" is expired and cannot be sold`,
        });
      }

      // Allocate batches (FIFO), create OrderDetailBatches, reduce stock,
      // update Inventory, and create SALE movements — atomically.
      try {
        await allocateBatchesToOrderDetail(detail.id, detail.productId, detail.qty, {
          userId: req.user ? req.user.id : null,
          transaction,
        });
      } catch (err) {
        await transaction.rollback();
        const message = err.message || "Failed to allocate stock for this order";
        // Map known allocation errors to clear 400 responses so the
        // frontend can show the cashier a meaningful message.
        if (
          message.includes("No batches available") ||
          message.includes("Insufficient stock") ||
          message.includes("Stock")
        ) {
          return res.status(400).json({ success: false, message });
        }
        return res.status(500).json({ success: false, message: "Internal server error", details: message });
      }
    }

    await order.update({ status: "completed" }, { transaction });

    // Create a CASH Payment record if none exists for this order.
    // ABA PayWay orders already have a Payment created by POST /:orderId
    // in payment.js, so this guard prevents duplicates.
    const existingPayment = await Payment.findOne({
      where: { orderId: order.id },
      transaction,
    });
    if (!existingPayment) {
      await Payment.create(
        {
          orderId: order.id,
          method: "CASH",
          status: "PAID",
          amount: Number(order.total),
          remark: "Cash payment at confirm",
          paidAt: new Date(),
        },
        { transaction }
      );
    }

    await transaction.commit();

    //  Fire Telegram notification after response is sent (non-blocking)
    const safeRes = res;
    safeRes.on('finish', () => {
      // Build cashier name from JWT (fields: { id, email, fullName, role })
      const cashierName = req.user
        ? req.user.fullName || req.user.email || 'Unknown'
        : 'Unknown';

      // Determine actual payment method from req body or default to Cash
      const paymentMethod = req.body?.paymentMethod === 'aba' || req.body?.paymentMethod === 'KHQR'
        ? 'ABA PayWay (KHQR)'
        : 'Cash';

      sendTelegramMessage(formatOrderMessage({
        orderNumber: order.orderNumber,
        total:       Number(order.total).toFixed(2),
        payment:     paymentMethod,
        items:       order.orderDetails.length,
        cashier:     cashierName,
        time:        new Date().toLocaleString('en-US', {
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', hour12: true,
        }),
      }));
    });

    res.json({ success: true, message: "Order confirmed and stock deducted", data: order });

  } catch (error) {
    await transaction.rollback();
    console.error("❌ Confirm order error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── PATCH: Cancel Order ──────────────────────────────────
router.patch("/:id/cancel", async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { id } = req.params;

    const order = await Order.findByPk(id, {
      include: [{ model: OrderDetail, as: "orderDetails" }],
      transaction,
    });

    if (!order) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: `Order id=${id} not found` });
    }
    if (order.status === "cancelled") {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: "Order already cancelled" });
    }

    //  Only restore stock if order was completed (stock was deducted)
    if (order.status === "completed") {
      for (const detail of order.orderDetails) {
        // processReturn restores to the original batch(es) via OrderDetailBatch
        // records, updates Inventory, and creates RETURN movements.
        await processReturn(detail.id, detail.productId, detail.qty, { transaction });
      }
    }
    await order.update(
      {
        status:       "cancelled",
        cancelledAt:  new Date(),
        cancelReason: req.body.reason || "Customer cancelled",
      },
      { transaction }
    );

    await transaction.commit();

    res.json({
      success: true,
      message: "Order cancelled",
      data: { orderId: order.id, orderNumber: order.orderNumber, status: "cancelled" },
    });

  } catch (error) {
    await transaction.rollback();
    console.error(" Cancel order error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── POST: Return items from a completed order ─────────────
// Body: { orderDetailId, qty }
// Restores stock to the original batch(es) and creates RETURN movements.
router.post("/:id/return", authenticate, requireRole("admin", "cashier"), async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { id } = req.params;
    const { orderDetailId, qty } = req.body;

    if (!orderDetailId || !qty || Number(qty) <= 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "orderDetailId and positive qty are required",
      });
    }

    const order = await Order.findByPk(id, {
      include: [{ model: OrderDetail, as: "orderDetails" }],
      transaction,
    });

    if (!order) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: `Order id=${id} not found` });
    }

    if (order.status !== "completed") {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Only completed orders can be returned",
      });
    }

    // Verify the orderDetail belongs to this order
    const detail = order.orderDetails.find((d) => d.id === Number(orderDetailId));
    if (!detail) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: `Order detail id=${orderDetailId} not found in this order`,
      });
    }

    const returnQty = Number(qty);

    // Check already-completed returns for this line item to prevent duplicates
    const existingReturns = await Return.findAll({
      where: {
        orderDetailId: detail.id,
        status: "COMPLETED",
      },
      attributes: ["quantity"],
      transaction,
    });
    const alreadyReturned = existingReturns.reduce((s, r) => s + Number(r.quantity || 0), 0);
    const remainingReturnable = detail.qty - alreadyReturned;

    if (returnQty > remainingReturnable) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `Cannot return ${returnQty} unit(s) — only ${remainingReturnable} unit(s) remain returnable for this item (${alreadyReturned}/${detail.qty} already returned)`,
      });
    }

    // Process the return: restore stock, update Inventory, create movements
    const movements = await processReturn(detail.id, detail.productId, returnQty, {
      userId: req.user ? req.user.id : null,
      transaction,
    });

    // Resolve the batch used for this order detail (for Return record)
    const firstBatch = await OrderDetailBatch.findOne({
      where: { orderDetailId: detail.id },
      transaction,
    });

    // Create a Return DB record for Sale History traceability
    const unitRefund = detail.qty > 0 ? Number(detail.amount) / detail.qty : 0;
    const returnRecord = await Return.create({
      orderId:        order.id,
      orderDetailId:  detail.id,
      productId:      detail.productId,
      batchId:        firstBatch ? firstBatch.batchId : null,
      quantity:       returnQty,
      refundAmount:   Number((unitRefund * returnQty).toFixed(2)),
      reason:         req.body.reason || null,
      refundMethod:   req.body.refundMethod || "Cash",
      status:         "COMPLETED",
      processedBy:    req.user ? req.user.id : null,
    }, { transaction });

    await transaction.commit();

    res.json({
      success: true,
      message: `Returned ${returnQty} unit(s) of "${detail.productName}"`,
      data: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        orderDetailId: detail.id,
        productName: detail.productName,
        returnedQty: returnQty,
        refundAmount: returnRecord.refundAmount,
        movements: movements.length,
        returnRecord: returnRecord,
      },
    });
  } catch (error) {
    await transaction.rollback();
    console.error("Return order error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET: All Orders (with filters) ───────────────────────
router.get("/", async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      dateFrom,
      dateTo,
      userId,
      status,
      paymentMethod,
    } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    const where = {};

    // Date range filter
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt[Op.gte] = new Date(`${dateFrom}T00:00:00.000Z`);
      if (dateTo)   where.createdAt[Op.lte] = new Date(`${dateTo}T23:59:59.999Z`);
    }

    // Cashier filter
    if (userId) where.userId = Number(userId);

    // Order status filter
    if (status && ["pending", "completed", "cancelled"].includes(status)) {
      where.status = status;
    }

    // Search: order number
    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      where[Op.or] = [{ orderNumber: { [Op.iLike]: term } }];
    }

    // Payment method filter (requires subquery since it lives on Payment)
    let paymentMethodOrderIds = null;
    if (paymentMethod) {
      const paymentRows = await Payment.findAll({
        where: { method: { [Op.iLike]: paymentMethod } },
        attributes: ["orderId"],
        raw: true,
      });
      paymentMethodOrderIds = paymentRows.map((p) => p.orderId);
    }

    const { count, rows } = await Order.findAndCountAll({
      where,
      include: [
        {
          model: OrderDetail,
          as: "orderDetails",
          include: [
            {
              model: Product,
              as: "product",
              attributes: ["id", "name", "sku", "price", "barcode"],
            },
            {
              model: OrderDetailBatch,
              as: "orderDetailBatches",
              include: [
                {
                  model: ProductBatch,
                  as: "productBatch",
                  attributes: ["id", "batchNumber", "expireDate"],
                },
              ],
            },
          ],
        },
        {
          model: Payment,
          as: "payments",
          required: false,
          separate: true,
          limit: 1,
          order: [["createdAt", "DESC"]],
        },
        {
          model: User,
          as: "user",
          attributes: ["id", "firstName", "lastName", "email", "role"],
          required: false,
        },
        {
          model: Return,
          as: "returns",
          required: false,
          separate: true,
          include: [
            {
              model: User,
              as: "processedByUser",
              attributes: ["id", "firstName", "lastName", "email", "role"],
            },
            {
              model: Product,
              as: "product",
              attributes: ["id", "name", "sku"],
            },
          ],
        },
      ],
      order: [["createdAt", "DESC"]],
      limit:  Number(limit),
      offset,
    });

    // Post-filter by payment method if needed (avoids INNER JOIN exclusion)
    let data = rows;
    if (paymentMethodOrderIds !== null) {
      if (paymentMethodOrderIds.length === 0) {
        data = [];
      } else {
        data = rows.filter((o) => paymentMethodOrderIds.includes(o.id));
      }
    }

    // Build returnedQty map from COMPLETED returns, then serialize
    // each order explicitly so the computed field reaches the response.
    const serialized = data.map((order) => {
      const detailReturns = order.returns || [];
      const returnedMap = {};
      for (const r of detailReturns) {
        if (r.status !== "COMPLETED") continue;
        const key = r.orderDetailId;
        returnedMap[key] = (returnedMap[key] || 0) + Number(r.quantity || 0);
      }

      const orderJson = order.toJSON();
      orderJson.orderDetails = (orderJson.orderDetails || []).map((d) => ({
        ...d,
        returnedQty: returnedMap[d.id] || 0,
      }));
      return orderJson;
    });

    res.json({
      success: true,
      data: serialized,
      total: count,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(count / limit),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── GET: Order by ID ─────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const order = await Order.findByPk(req.params.id, {
      include: [
        {
          model: OrderDetail,
          as: "orderDetails",
          include: [
            {
              model: Product,
              as: "product",
              attributes: ["id", "name", "sku", "price", "barcode"],
            },
            {
              model: OrderDetailBatch,
              as: "orderDetailBatches",
              include: [
                {
                  model: ProductBatch,
                  as: "productBatch",
                  attributes: ["id", "batchNumber", "expireDate"],
                },
              ],
            },
          ],
        },
        {
          model: Payment,
          as: "payments",
          required: false,
          separate: true,
          limit: 1,
          order: [["createdAt", "DESC"]],
        },
        {
          model: User,
          as: "user",
          attributes: ["id", "firstName", "lastName", "email", "role"],
          required: false,
        },
        {
          model: Return,
          as: "returns",
          required: false,
          separate: true,
          include: [
            {
              model: User,
              as: "processedByUser",
              attributes: ["id", "firstName", "lastName", "email", "role"],
            },
            {
              model: Product,
              as: "product",
              attributes: ["id", "name", "sku"],
            },
          ],
        },
      ],
    });
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    // Build returnedQty map from COMPLETED returns, then serialize
    // the order explicitly so the computed field reaches the response.
    const detailReturns = order.returns || [];
    const returnedMap = {};
    for (const r of detailReturns) {
      if (r.status !== "COMPLETED") continue;
      const key = r.orderDetailId;
      returnedMap[key] = (returnedMap[key] || 0) + Number(r.quantity || 0);
    }

    const orderJson = order.toJSON();
    orderJson.orderDetails = (orderJson.orderDetails || []).map((d) => ({
      ...d,
      returnedQty: returnedMap[d.id] || 0,
    }));
    res.json({ success: true, data: orderJson });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Helper ───────────────────────────────────────────────
function generateInvoiceNumber() {
  const now     = new Date();
  const year    = now.getFullYear();
  const month   = String(now.getMonth() + 1).padStart(2, "0");
  const day     = String(now.getDate()).padStart(2, "0");
  const hours   = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  const ms      = String(now.getMilliseconds()).padStart(3, "0");
  return `N/A-${year}${month}${day}-${hours}${minutes}${seconds}${ms}`;
}

module.exports = router;