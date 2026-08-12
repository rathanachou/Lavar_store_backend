const app = require("express");
const { Payment, Customer, Order, OrderDetail, Product } = require("../../models");
const { sequelize } = require("../../models");
const axios = require("axios");
const { sendTelegramMessage, formatOrderMessage } = require("../utils/telegram");
const { buildPurchaseHash, encodeBase64, getReqTime, buildCheckTransactionHash } = require("../utils/payway");
const { deductStockFifo, isExpired } = require("../utils/batchStock");

const router = app.Router();

// ─── POST: Create Payment ─────────────────────────────────
router.post("/:orderId", async (req, res) => {
  const { orderId } = req.params;
  try {
    const order = await Order.findByPk(orderId, {
      include: [
        { model: Customer,     as: "customer"     },
        { model: OrderDetail,  as: "orderDetails" },
      ],
    });

    if (!order) {
      return res.status(404).json({ message: `Order id=${orderId} not found` });
    }

    // Prevent duplicate PENDING payment
    const existing = await Payment.findOne({ where: { orderId, status: "PENDING" } });
    if (existing) {
      return res.status(400).json({ message: "Payment already pending for this order" });
    }

    const paywayTranId = `ORD-${Date.now()}`;

    const payment = await Payment.create({
      orderId:      order.id,
      paywayTranId,
      method:       "ABA_PAYWAY",
      status:       "PENDING",
      remark:       "Pay via aba payway",
      amount:       order.total,
    });

    const req_time = getReqTime();

    // ── Dynamic redirect base ─────────────────────────────────────
    // The frontend sends its current origin (window.location.origin) so the
    // payment gateway redirects back to the correct environment — localhost
    // during dev, production in deploy.  Fall back to FRONTEND_URL for
    // backward compatibility (e.g. direct API calls without an origin).
    const redirectBase =
      (req.body.origin || "").trim() ||
      (process.env.FRONTEND_URL || "").trim();
    // ──────────────────────────────────────────────────────────────

    // Convert USD order.total → whole-number KHR for ABA PayWay (sandbox merchant
    // ec476939 is KHR-based). Rate is env-driven so it can be updated without a deploy.
    const khrRate    = Number(process.env.ABA_PAYWAY_KHR_RATE) || 4100;
    const amountKhr  = Math.round(Number(order.total) * khrRate);

    let paywayItems = JSON.stringify(
      order.orderDetails?.map((detail) => ({
        name:     detail.productName,
        quantity: detail.qty,
        price:    Math.round(Number(detail.productPrice) * khrRate),
      }))
    );
    paywayItems = encodeBase64(paywayItems);

    const paymentPayload = {
      merchant_id:          process.env.ABA_PAYWAY_MERCHANT_ID,
      req_time,
      tran_id:              paywayTranId,
      amount:               String(amountKhr),
      items:                paywayItems,
      shipping:             "0.00",
      firstname:            order.customer?.name  || "NA",
      lastname:             "",
      email:                order.customer?.email || "NA@gmail.com",
      phone:                order.customer?.phone || "000000000",
      type:                 "purchase",
      view_type:            "popup",
      payment_option:       "abapay_khqr",
      return_url:           `${redirectBase}/admin/pos`,
      cancel_url:           `${redirectBase}/admin/pos`,
      continue_success_url: `${redirectBase}/admin/pos?tranId=${paywayTranId}`,
      currency:             "KHR",
      payment_gate:         0,
      return_deeplink:      "",
      custom_fields:        "",
      return_params:        "",
      payout:               "",
      lifetime:             "30",
      additional_params:    "",
      google_pay_token:     "",
      skip_success_page:    "",
    };

    const hash = buildPurchaseHash(paymentPayload);

    return res.json({
      message: "Payment created successfully",
      data: {
        payment,
        payway: {
          action: `${process.env.ABA_PAYWAY_BASE_URL}/api/payment-gateway/v1/payments/purchase`,
          method: "POST",
          target: "aba_webservice",
          id:     "aba_merchant_request",
          fields: { ...paymentPayload, hash },
        },
      },
    });
  } catch (error) {
    console.error("❌ Create payment error:", error.message);
    res.status(500).json({ message: error.message });
  }
});

// ─── POST: Check Transaction + Confirm Order if PAID ─────
router.post("/:tranId/check", async (req, res) => {
  try {
    const { tranId } = req.params;

    const payment = await Payment.findOne({ where: { paywayTranId: tranId } });

    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    const req_time    = getReqTime();
    const merchant_id = process.env.ABA_PAYWAY_MERCHANT_ID;
    const tran_id     = payment.paywayTranId;
    const hash        = buildCheckTransactionHash({ req_time, merchant_id, tran_id });

    const response = await axios.post(
      `${process.env.ABA_PAYWAY_BASE_URL}/api/payment-gateway/v1/payments/check-transaction-2`,
      { req_time, merchant_id, tran_id, hash }
    );

    console.log(" ABA response:", response.data);

    const abaData           = response.data;
    const statusCode        = abaData?.status?.code;
    const paymentStatusCode = abaData?.data?.payment_status_code;
    const paymentStatus     = abaData?.data?.payment_status;

    if (statusCode === "00") {

      if (paymentStatusCode === 0 && paymentStatus === "APPROVED") {
        // ─── Payment APPROVED ─────────────────────────────
        payment.status = "PAID";
        payment.paidAt = abaData?.data?.transaction_date;
        payment.remark = JSON.stringify(abaData);
        await payment.save();

        //  Confirm order directly via models (no internal HTTP — avoids 401)
        await confirmOrder(payment.orderId);

        console.log(`✅ Order ${payment.orderId} confirmed after payment`);

      } else if (
        paymentStatus === "DECLINED" ||
        paymentStatus === "FAILED"   ||
        paymentStatusCode !== 0
      ) {
        // ─── Payment FAILED ───────────────────────────────
        payment.status = "FAILED";
        payment.remark = JSON.stringify(abaData);
        await payment.save();

        // Cancel order — no stock to restore (was never deducted)
        await cancelOrder(payment.orderId, `Payment ${paymentStatus}`);

        console.log(`❌ Order ${payment.orderId} cancelled — payment ${paymentStatus}`);

      } else {
        // ─── Still PENDING ────────────────────────────────
        payment.status = "PENDING";
        payment.remark = JSON.stringify(abaData);
        await payment.save();
      }
    }

    return res.json({
      message: "Payment checked successfully",
      data: { payment, aba: abaData },
    });

  } catch (error) {
    console.error("❌ Check payment error:", error.message);
    res.status(500).json({ message: error.message });
  }
});

// ─── Helper: Confirm Order + Deduct Stock + Telegram ─────
async function confirmOrder(orderId) {
  const transaction = await sequelize.transaction();
  try {
    const order = await Order.findByPk(orderId, {
      include: [{ model: OrderDetail, as: "orderDetails" }],
      transaction,
    });

    if (!order) throw new Error(`Order id=${orderId} not found`);
    if (order.status === "completed") {
      await transaction.rollback();
      console.log(`⚠️ Order ${orderId} already completed — skipping`);
      return;
    }

    //  Deduct stock now
    for (const detail of order.orderDetails) {
      const product = await Product.findByPk(detail.productId, { transaction });
      if (!product) throw new Error(`Product id=${detail.productId} not found`);
      //  Block expired products before deducting stock — checked live against the
      //  soonest qty>0 batch so a product that expired after order creation can't
      //  complete. Throwing rolls back the whole confirm.
      if (await isExpired(detail.productId, { transaction })) {
        throw new Error(`Product "${product.name}" is expired and cannot be sold`);
      }
      if (product.qty < detail.qty) throw new Error(`Stock មិនគ្រប់ "${product.name}"`);
      // Deduct FIFO (soonest-expiring batch first)
      await deductStockFifo(detail.productId, detail.qty, { transaction });
    }

    await order.update({ status: "completed" }, { transaction });
    await transaction.commit();

    //  Fire Telegram notification (non-blocking — no await)
    const cashierName = 'Walk-in Customer';

    sendTelegramMessage(formatOrderMessage({
      orderNumber: order.orderNumber,
      total:       Number(order.total).toFixed(2),
      payment:     'ABA PayWay (KHQR)',
      items:       order.orderDetails.length,
      cashier:     cashierName,
      time:        new Date().toLocaleString('en-US', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: true,
      }),
    }));

    console.log(`✅ Stock deducted for order ${orderId}, Telegram notification dispatched`);
  } catch (error) {
    await transaction.rollback();
    console.error("❌ confirmOrder error:", error.message);
    throw error;
  }
}

// ─── Helper: Cancel Order ─────────────────────────────────
async function cancelOrder(orderId, reason = "Payment failed") {
  try {
    const order = await Order.findByPk(orderId);
    if (!order || order.status === "cancelled") return;
    await order.update({ status: "cancelled", cancelledAt: new Date(), cancelReason: reason });
    console.log(` Order ${orderId} cancelled: ${reason}`);
  } catch (error) {
    console.error("❌ cancelOrder error:", error.message);
  }
}

module.exports = router;