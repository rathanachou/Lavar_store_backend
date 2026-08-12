const express = require("express");
const { Order, Customer, OrderDetail, Product } = require("../../models");
const { sendTelegramMessage, formatOrderMessage } = require("../utils/telegram");
const { sequelize } = require("../../models");
const { deductStockFifo, restoreStockToBatch, isExpired } = require("../utils/batchStock");

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

    //  Deduct stock only after payment confirmed
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

      if (product.qty < detail.qty) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Stock  "${product.name}"  payment`,
        });
      }

      // Deduct FIFO (soonest-expiring batch first)
      await deductStockFifo(detail.productId, detail.qty, { transaction });
    }

    await order.update({ status: "completed" }, { transaction });
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
        const product = await Product.findByPk(detail.productId, { transaction });
        if (product) {
          // Return to the batch FIFO would have deducted next (or a new batch)
          await restoreStockToBatch(detail.productId, detail.qty, { transaction });
        }
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

// ─── GET: All Orders ──────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const { page = 1, limit = 10, search = "" } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    const { count, rows } = await Order.findAndCountAll({
      include: [{ model: OrderDetail, as: "orderDetails" }],
      order:  [["createdAt", "DESC"]],
      limit:  Number(limit),
      offset,
    });

    res.json({ success: true, data: rows, total: count, page: Number(page), limit: Number(limit) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── GET: Order by ID ─────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const order = await Order.findByPk(req.params.id, {
      include: [{ model: OrderDetail, as: "orderDetails" }],
    });
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    res.json({ success: true, data: order });
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