const express = require("express");
const { Order, OrderDetail, Payment, Return, Product, ProductBatch, User, sequelize } = require("../../models");
const { Op } = require("sequelize");
const PDFDocument = require("pdfkit");
const dayjs = require("dayjs");
const path = require("path");
const requireRole = require("../middlewares/requireRole");

// Khmer-capable font for Riel symbol and any Khmer text.
// PDFKit's built-in Helvetica/Times only support Latin-1 — U+17DB (៛)
// renders as "Ů" without an explicit Khmer font.
const KHMER_FONT = path.join(__dirname, "../assets/fonts/KhmerUI.ttf");
const {
  buildPaymentMap,
  splitOrdersByStatus,
  aggregateCompletedOrders,
  aggregateCancelledOrders,
  buildDailyBreakdown,
  getPaymentMethod,
  aggregateReturns,
} = require("../utils/reportHelpers");

const router = express.Router();

// ─── GET: Daily Sales Report JSON ──────────────────────────
router.get("/daily-sales", async (req, res) => {
  try {
    // Cashiers may only view today's report — ignore any date they send.
    const isCashier = req.user?.role === "cashier";
    const date = isCashier
      ? dayjs().format("YYYY-MM-DD")
      : (req.query.date || dayjs().format("YYYY-MM-DD"));

    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd   = new Date(`${date}T23:59:59.999Z`);

    // ── Fetch all orders for the date (all statuses) ────────
    const orders = await Order.findAll({
      where: {
        createdAt: { [Op.between]: [dayStart, dayEnd] },
      },
      include: [
        { model: OrderDetail, as: "orderDetails" },
      ],
      order: [["createdAt", "ASC"]],
    });

    // ── Fetch payments for those orders ─────────────────────
    const orderIds = orders.map((o) => o.id);
    const payments = orderIds.length > 0
      ? await Payment.findAll({ where: { orderId: orderIds } })
      : [];
    const paymentMap = buildPaymentMap(payments);

    // ── Fetch returns for those orders (with processor info) ──
    const returns = orderIds.length > 0
      ? await Return.findAll({
          where: { orderId: orderIds, status: { [Op.not]: "CANCELLED" } },
          include: [
            {
              model: Order,
              as: "order",
              attributes: ["id", "orderNumber"],
            },
            {
              model: Product,
              as: "product",
              attributes: ["id", "name"],
            },
            {
              model: User,
              as: "processedByUser",
              attributes: ["id", "firstName", "lastName", "email"],
            },
          ],
          order: [["createdAt", "DESC"]],
        })
      : [];
    const returnsSummary = aggregateReturns(returns);

    // ── Split by status: completed = revenue, cancelled = separate ──
    const { completed, cancelled } = splitOrdersByStatus(orders);

    // ── Aggregate completed orders ──────────────────────────
    const agg = aggregateCompletedOrders(completed, paymentMap);
    const cancelledSummary = aggregateCancelledOrders(cancelled);

    // Net returns out of revenue so Total Revenue reflects what the store
    // actually kept, not the gross amount before refunds.
    const totalRefunded = Number(
      returnsSummary.reduce((s, r) => s + r.refundAmount, 0).toFixed(2)
    );
    const netRevenue = Number((agg.totalRevenue - totalRefunded).toFixed(2));

    // Rate used to convert KHR → USD equivalent on the frontend Riel card.
    const usdToKhrRate = Number(process.env.ABA_PAYWAY_KHR_RATE) || 4100;

    res.json({
      success: true,
      date,
      summary: {
        totalRevenue: netRevenue,
        totalTransactions: completed.length,
        totalItemsSold: agg.totalItemsSold,
        grossSales: Number(agg.grossSales.toFixed(2)),
        totalDiscount: Number(agg.totalDiscount.toFixed(2)),
        netSales: netRevenue,
        rielKhr: Number(agg.totalRielKhr.toFixed(0)),
        usdToKhrRate,
        paymentMethodBreakdown: agg.paymentMethodBreakdown,
        cancelled: {
          count: cancelledSummary.count,
          totalValue: Number(cancelledSummary.totalValue.toFixed(2)),
          totalItems: cancelledSummary.totalItems,
        },
        returns: {
          count: returnsSummary.length,
          totalRefunded,
        },
      },
      transactions: agg.transactions,
      returns: returnsSummary,
    });
  } catch (error) {
    console.error("❌ Daily sales report error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── GET: Download Daily Sales Report PDF ──────────────────
router.get("/daily-sales/pdf", async (req, res) => {
  try {
    // Cashiers may only download today's report.
    const isCashier = req.user?.role === "cashier";
    const date = isCashier
      ? dayjs().format("YYYY-MM-DD")
      : (req.query.date || dayjs().format("YYYY-MM-DD"));

    // Reuse the same logic by fetching report data
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd   = new Date(`${date}T23:59:59.999Z`);

    const orders = await Order.findAll({
      where: {
        createdAt: { [Op.between]: [dayStart, dayEnd] },
      },
      include: [
        { model: OrderDetail, as: "orderDetails" },
      ],
      order: [["createdAt", "ASC"]],
    });

    const orderIds = orders.map((o) => o.id);
    const payments = orderIds.length > 0
      ? await Payment.findAll({ where: { orderId: orderIds } })
      : [];

    const paymentMap = buildPaymentMap(payments);
    const { completed, cancelled } = splitOrdersByStatus(orders);
    const agg = aggregateCompletedOrders(completed, paymentMap);
    const cancelledSummary = aggregateCancelledOrders(cancelled);

    // ── Fetch returns for those orders (with processor info) ──
    const pdfReturns = orderIds.length > 0
      ? await Return.findAll({
          where: { orderId: orderIds, status: { [Op.not]: "CANCELLED" } },
          include: [
            {
              model: Order,
              as: "order",
              attributes: ["id", "orderNumber"],
            },
            {
              model: Product,
              as: "product",
              attributes: ["id", "name"],
            },
            {
              model: User,
              as: "processedByUser",
              attributes: ["id", "firstName", "lastName", "email"],
            },
          ],
          order: [["createdAt", "DESC"]],
        })
      : [];
    const returnsSummary = aggregateReturns(pdfReturns);

    // Net returns out of revenue for the PDF display.
    const pdfTotalRefunded = Number(
      returnsSummary.reduce((s, r) => s + r.refundAmount, 0).toFixed(2)
    );
    const pdfNetRevenue = Number((agg.totalRevenue - pdfTotalRefunded).toFixed(2));

    // ── Build PDF ─────────────────────────────────────────
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    doc.registerFont("Khmer", KHMER_FONT);

    // Set response headers
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="daily-sales-${date}.pdf"`
    );

    // Crash-safety: if the client disconnects or an error occurs mid-stream,
    // log it and end the response cleanly instead of letting the unhandled
    // error propagate and crash the Node process.
    doc.on("error", (err) => {
      console.error("❌ Daily PDF stream error:", err.message);
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: "PDF generation failed" });
      } else {
        res.end();
      }
    });
    res.on("close", () => {
      if (!doc.destroyed) doc.destroy();
    });

    doc.pipe(res);

    // ── Colors ────────────────────────────────────────────
    const primaryColor   = "#1e40af"; // blue-800
    const accentColor    = "#3b82f6"; // blue-500
    const grayColor      = "#6b7280";
    const lightGray      = "#f3f4f6";
    const borderColor    = "#d1d5db";
    const successColor   = "#16a34a";
    const warningColor   = "#d97706";

    // ── Header ────────────────────────────────────────────
    doc.fontSize(22).font("Helvetica-Bold").fillColor(primaryColor)
       .text("LEVA Store", 40, 40);
    doc.fontSize(10).font("Helvetica").fillColor(grayColor)
       .text("Daily Sales Report", 40, 68);
    doc.fontSize(9).fillColor(grayColor)
       .text(`Date: ${dayjs(date).format("dddd, MMMM D, YYYY")}`, 40, 84);

    // Line separator
    doc.moveTo(40, 100).lineTo(545, 100)
       .lineWidth(1.5).strokeColor(accentColor).stroke();

    // ── Summary Section ───────────────────────────────────
    let y = 120;

    doc.fontSize(13).font("Helvetica-Bold").fillColor(primaryColor)
       .text("Summary", 40, y);
    y += 22;

    // Summary boxes — width adapts to the count so all fit on one A4 row
    // (505pt content width) even with the Riel box added.
    const boxH = 52;
    const gap = 12;
    const startX = 40;

    const summaryItems = [
      { label: "Total Revenue",  value: `$${pdfNetRevenue.toFixed(2)}`,  color: successColor },
      { label: "Transactions",   value: String(completed.length),          color: accentColor },
      { label: "Items Sold",     value: String(agg.totalItemsSold),         color: warningColor },
      { label: "Discount",       value: `$${agg.totalDiscount.toFixed(2)}`, color: "#d97706" },
    ];

    // Only show the Riel summary box when any KHR was collected that day.
    if (agg.totalRielKhr > 0) {
      summaryItems.push({
        label: "Riel (៛)",
        value: `៛${Math.round(agg.totalRielKhr).toLocaleString("en-US")}`,
        color: "#0f766e",
      });
    }

    const boxW = Math.min(120, (505 - gap * (summaryItems.length - 1)) / summaryItems.length);

    summaryItems.forEach((item, i) => {
      const x = startX + i * (boxW + gap);
      const isRiel = item.label.includes("Riel");
      const labelFont = isRiel ? "Khmer" : "Helvetica";
      const valueFont = isRiel ? "Khmer" : "Helvetica-Bold";
      doc.roundedRect(x, y, boxW, boxH, 6).fillColor("#f8fafc").fill()
         .roundedRect(x, y, boxW, boxH, 6).lineWidth(1).strokeColor(borderColor).stroke();
      doc.fontSize(10).font(labelFont).fillColor(grayColor)
         .text(item.label, x + 10, y + 8, { width: boxW - 20, align: "center" });
      doc.fontSize(14).font(valueFont).fillColor(item.color)
         .text(item.value, x + 10, y + 24, { width: boxW - 20, align: "center" });
    });

    y += boxH + 20;

    // ── Payment Method Breakdown ──────────────────────────
    doc.fontSize(13).font("Helvetica-Bold").fillColor(primaryColor)
       .text("Payment Method Breakdown", 40, y);
    y += 22;

    const methodColors = {
      CASH:       "#16a34a",
      ABA_PAYWAY: "#2563eb",
      KHQR:       "#d97706",
      OTHER:      "#6b7280",
    };

    for (const [method, amount] of Object.entries(agg.paymentMethodBreakdown)) {
      const displayName = method === "ABA_PAYWAY" ? "ABA PayWay"
                        : method.charAt(0) + method.slice(1).toLowerCase();
      const amountNum = Number(amount) || 0;

      doc.roundedRect(40, y, 505, 24, 4).fillColor(lightGray).fill();
      doc.fontSize(10).font("Helvetica").fillColor(grayColor)
         .text(displayName, 50, y + 6);
      doc.fontSize(10).font("Helvetica-Bold").fillColor(methodColors[method] || grayColor)
         .text(`$${amountNum.toFixed(2)}`, 480, y + 6, { align: "right" });
      y += 30;
    }

    // Riel collected that day (when any KHR payment happened).
    if (agg.totalRielKhr > 0) {
      doc.roundedRect(40, y, 505, 24, 4).fillColor("#ccfbf1").fill();
      doc.fontSize(10).font("Khmer").fillColor("#0f766e")
         .text("Riel (៛)", 50, y + 6);
      doc.fontSize(10).font("Khmer").fillColor("#0f766e")
         .text(`៛${Math.round(agg.totalRielKhr).toLocaleString("en-US")}`, 480, y + 6, { align: "right" });
      y += 30;
    }

    // Cancelled orders summary (separate from revenue)
    if (cancelledSummary.count > 0) {
      y += 10;
      doc.fontSize(13).font("Helvetica-Bold").fillColor(primaryColor)
         .text("Cancelled Orders", 40, y);
      y += 22;

      const cancelledBoxes = [
        { label: "Cancelled", value: String(cancelledSummary.count), color: "#ef4444" },
        { label: "Cancelled Value", value: `$${cancelledSummary.totalValue.toFixed(2)}`, color: "#ef4444" },
        { label: "Items Cancelled", value: String(cancelledSummary.totalItems), color: "#ef4444" },
      ];

      const cBoxW = Math.min(120, (505 - gap * (cancelledBoxes.length - 1)) / cancelledBoxes.length);
      cancelledBoxes.forEach((item, i) => {
        const x = startX + i * (cBoxW + gap);
        doc.roundedRect(x, y, cBoxW, boxH, 6).fillColor("#fef2f2").fill()
           .roundedRect(x, y, cBoxW, boxH, 6).lineWidth(1).strokeColor("#fecaca").stroke();
        doc.fontSize(10).font("Helvetica").fillColor(grayColor)
           .text(item.label, x + 10, y + 8, { width: cBoxW - 20, align: "center" });
        doc.fontSize(14).font("Helvetica-Bold").fillColor(item.color)
           .text(item.value, x + 10, y + 24, { width: cBoxW - 20, align: "center" });
      });
      y += boxH + 20;
    }

    // Returns section
    if (returnsSummary.length > 0) {
      y += 10;
      doc.fontSize(13).font("Helvetica-Bold").fillColor("#7c3aed")
         .text("Returns", 40, y);
      y += 22;

      const returnBoxes = [
        { label: "Returns", value: String(returnsSummary.length), color: "#7c3aed" },
        { label: "Total Refunded", value: `$${returnsSummary.reduce((s, r) => s + r.refundAmount, 0).toFixed(2)}`, color: "#7c3aed" },
      ];

      const rBoxW = Math.min(120, (505 - gap * (returnBoxes.length - 1)) / returnBoxes.length);
      returnBoxes.forEach((item, i) => {
        const x = startX + i * (rBoxW + gap);
        doc.roundedRect(x, y, rBoxW, boxH, 6).fillColor("#f5f3ff").fill()
           .roundedRect(x, y, rBoxW, boxH, 6).lineWidth(1).strokeColor("#ddd6fe").stroke();
        doc.fontSize(10).font("Helvetica").fillColor(grayColor)
           .text(item.label, x + 10, y + 8, { width: rBoxW - 20, align: "center" });
        doc.fontSize(14).font("Helvetica-Bold").fillColor(item.color)
           .text(item.value, x + 10, y + 24, { width: rBoxW - 20, align: "center" });
      });
      y += boxH + 20;
    }

    y += 10;

    // ── Returns Table ─────────────────────────────────────
    if (returnsSummary.length > 0) {
      doc.fontSize(13).font("Helvetica-Bold").fillColor("#7c3aed")
         .text("Returns", 40, y);
      y += 22;

      const rColX = [40, 100, 260, 370, 430, 510];
      const rColW = [60, 160, 110, 60, 80, 35];
      const rHeaders = ["#", "Order No.", "Product", "Qty", "Processed By", "Method"];

      doc.roundedRect(40, y, 505, 20, 4).fillColor("#7c3aed").fill();
      doc.fontSize(9).font("Helvetica-Bold").fillColor("#ffffff");
      rHeaders.forEach((h, i) => {
        doc.text(h, rColX[i] + 4, y + 4, { width: rColW[i], align: i < 2 ? "left" : "center" });
      });
      y += 26;

      doc.fontSize(8).font("Helvetica");
      for (let i = 0; i < Math.min(returnsSummary.length, 20); i++) {
        const r = returnsSummary[i];
        if (i % 2 === 0) {
          doc.roundedRect(40, y, 505, 18, 3).fillColor("#faf5ff").fill();
        }
        doc.fillColor("#111827");
        doc.text(String(i + 1),              rColX[0] + 4, y + 4, { width: rColW[0], align: "center" });
        doc.text(r.orderNumber || "",        rColX[1] + 4, y + 4, { width: rColW[1] });
        doc.text(r.productName || "—",       rColX[2] + 4, y + 4, { width: rColW[2] });
        doc.text(String(r.quantity),         rColX[3] + 4, y + 4, { width: rColW[3], align: "center" });
        doc.text(r.processedBy || "Unknown", rColX[4] + 4, y + 4, { width: rColW[4] });
        doc.text(r.refundMethod || "Cash",   rColX[5] + 4, y + 4, { width: rColW[5], align: "center" });
        y += 22;

        if (y > 750) {
          doc.addPage();
          y = 40;
        }
      }
    }

    // ── Transactions Table ────────────────────────────────
    doc.fontSize(13).font("Helvetica-Bold").fillColor(primaryColor)
       .text("Transactions", 40, y);
    y += 22;

    // Table header
    const colX = [40, 80, 230, 305, 385, 465, 510];
    const colW = [40, 150, 75, 80, 80, 45, 35];
    const headers = ["#", "Order No.", "Items", "Amount", "Discount", "Method"];

    // Header background
    doc.roundedRect(40, y, 505, 20, 4).fillColor(primaryColor).fill();
    doc.fontSize(9).font("Helvetica-Bold").fillColor("#ffffff");
    headers.forEach((h, i) => {
      doc.text(h, colX[i] + 4, y + 4, { width: colW[i], align: i === 0 ? "center" : "left" });
    });
    y += 26;

    // Table rows
    doc.fontSize(8).font("Helvetica");
    for (let i = 0; i < Math.min(agg.transactions.length, 30); i++) {
      const tx = agg.transactions[i];
      const method = tx.paymentMethod;

      // Alternating row bg
      if (i % 2 === 0) {
        doc.roundedRect(40, y, 505, 18, 3).fillColor("#f9fafb").fill();
      }

      doc.fillColor("#111827");
      doc.text(String(i + 1),           colX[0] + 4, y + 4, { width: colW[0], align: "center" });
      doc.text(tx.orderNumber || "",    colX[1] + 4, y + 4, { width: colW[1] });
      doc.text(String(tx.itemsCount),   colX[2] + 4, y + 4, { width: colW[2] });
      doc.text(`$${tx.total.toFixed(2)}`, colX[3] + 4, y + 4, { width: colW[3] });
      doc.text(`$${tx.discount.toFixed(2)}`, colX[4] + 4, y + 4, { width: colW[4] });
      doc.text(method,                  colX[5] + 4, y + 4, { width: colW[5] });
      y += 22;

      // New page if near end
      if (y > 750) {
        doc.addPage();
        y = 40;
      }
    }

    // ── Footer ────────────────────────────────────────────
    const remainingHeight = doc.page.height - y;
    if (remainingHeight < 50) {
      doc.addPage();
      y = 40;
    }
    y = Math.max(y, doc.page.height - 80);

    doc.moveTo(40, y).lineTo(545, y)
       .lineWidth(1).strokeColor(borderColor).stroke();
    doc.fontSize(8).font("Helvetica").fillColor(grayColor)
       .text(
         `Generated on ${dayjs().format("MMMM D, YYYY [at] h:mm A")} — LEVA Store POS System`,
         40, y + 8,
         { align: "center" }
       );

    doc.end();
  } catch (error) {
    console.error("❌ Daily sales PDF error:", error.message);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
});

// ─── GET: Monthly Sales Report JSON (admin only) ────────────
router.get("/monthly-sales", requireRole("admin"), async (req, res) => {
  try {
    // Accept either year/month (single month) or dateFrom/dateTo (range).
    // Range params take priority when both are present.
    const dateFrom = req.query.dateFrom;
    const dateTo   = req.query.dateTo;
    let dateStr;
    let rangeStart, rangeEnd;
    let isRange = false;

    if (dateFrom && dateTo) {
      isRange = true;
      dateStr = `${dateFrom} to ${dateTo}`;
      rangeStart = new Date(`${dateFrom}T00:00:00.000Z`);
      rangeEnd   = new Date(`${dateTo}T23:59:59.999Z`);
    } else {
      const year  = Number(req.query.year)  || dayjs().year();
      const month = String(req.query.month || dayjs().month() + 1).padStart(2, "0");
      dateStr = `${year}-${month}`;
      rangeStart = new Date(`${dateStr}-01T00:00:00.000Z`);
      rangeEnd   = new Date(rangeStart);
      rangeEnd.setUTCMonth(rangeEnd.getUTCMonth() + 1);
    }

    const orders = await Order.findAll({
      where: {
        createdAt: { [Op.gte]: rangeStart, [Op.lt]: rangeEnd },
      },
      include: [{ model: OrderDetail, as: "orderDetails" }],
      order: [["createdAt", "ASC"]],
    });

    const orderIds = orders.map((o) => o.id);
    const payments = orderIds.length > 0
      ? await Payment.findAll({ where: { orderId: orderIds } })
      : [];

    // ── Fetch returns for those orders (with processor info) ──
    const monthlyReturns = orderIds.length > 0
      ? await Return.findAll({
          where: { orderId: orderIds, status: { [Op.not]: "CANCELLED" } },
          include: [
            {
              model: Order,
              as: "order",
              attributes: ["id", "orderNumber"],
            },
            {
              model: Product,
              as: "product",
              attributes: ["id", "name"],
            },
            {
              model: User,
              as: "processedByUser",
              attributes: ["id", "firstName", "lastName", "email"],
            },
          ],
          order: [["createdAt", "DESC"]],
        })
      : [];
    const monthlyReturnsSummary = aggregateReturns(monthlyReturns);

    const paymentMap = buildPaymentMap(payments);
    const { completed, cancelled } = splitOrdersByStatus(orders);
    const agg = aggregateCompletedOrders(completed, paymentMap);
    const cancelledSummary = aggregateCancelledOrders(cancelled);

    // Net returns out of revenue so Total Revenue reflects what the store
    // actually kept, not the gross amount before refunds.
    const monthlyTotalRefunded = Number(
      monthlyReturnsSummary.reduce((s, r) => s + r.refundAmount, 0).toFixed(2)
    );
    const monthlyNetRevenue = Number((agg.totalRevenue - monthlyTotalRefunded).toFixed(2));

    // ── Aggregate by day (completed orders only) ────────────
    const dailyBreakdown = buildDailyBreakdown(completed);

    const usdToKhrRate = Number(process.env.ABA_PAYWAY_KHR_RATE) || 4100;

    res.json({
      success: true,
      date: dateStr,
      summary: {
        totalRevenue:   monthlyNetRevenue,
        totalTransactions: completed.length,
        totalItemsSold: agg.totalItemsSold,
        grossSales:     Number(agg.grossSales.toFixed(2)),
        totalDiscount:  Number(agg.totalDiscount.toFixed(2)),
        netSales:       monthlyNetRevenue,
        rielKhr:        Number(agg.totalRielKhr.toFixed(0)),
        usdToKhrRate,
        paymentMethodBreakdown: agg.paymentMethodBreakdown,
        cancelled: {
          count: cancelledSummary.count,
          totalValue: Number(cancelledSummary.totalValue.toFixed(2)),
          totalItems: cancelledSummary.totalItems,
        },
        returns: {
          count: monthlyReturnsSummary.length,
          totalRefunded: Number(
            monthlyReturnsSummary.reduce((s, r) => s + r.refundAmount, 0).toFixed(2)
          ),
        },
      },
      dailyBreakdown,
      returns: monthlyReturnsSummary,
    });
  } catch (error) {
    console.error("❌ Monthly sales report error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── GET: Download Monthly Sales Report PDF (admin only) ───
router.get("/monthly-sales/pdf", requireRole("admin"), async (req, res) => {
  try {
    // Accept either year/month (single month) or dateFrom/dateTo (range).
    // Range params take priority when both are present.
    const dateFrom = req.query.dateFrom;
    const dateTo   = req.query.dateTo;
    let dateStr;
    let rangeStart, rangeEnd;
    let isRange = false;

    if (dateFrom && dateTo) {
      isRange = true;
      dateStr = `${dateFrom} to ${dateTo}`;
      rangeStart = new Date(`${dateFrom}T00:00:00.000Z`);
      rangeEnd   = new Date(`${dateTo}T23:59:59.999Z`);
    } else {
      const year  = Number(req.query.year)  || dayjs().year();
      const month = String(req.query.month || dayjs().month() + 1).padStart(2, "0");
      dateStr = `${year}-${month}`;
      rangeStart = new Date(`${dateStr}-01T00:00:00.000Z`);
      rangeEnd   = new Date(rangeStart);
      rangeEnd.setUTCMonth(rangeEnd.getUTCMonth() + 1);
    }

    const orders = await Order.findAll({
      where: {
        createdAt: { [Op.gte]: rangeStart, [Op.lt]: rangeEnd },
      },
      include: [{ model: OrderDetail, as: "orderDetails" }],
      order: [["createdAt", "ASC"]],
    });

    const orderIds = orders.map((o) => o.id);
    const payments = orderIds.length > 0
      ? await Payment.findAll({ where: { orderId: orderIds } })
      : [];

    const paymentMap = buildPaymentMap(payments);
    const { completed, cancelled } = splitOrdersByStatus(orders);
    const agg = aggregateCompletedOrders(completed, paymentMap);
    const cancelledSummary = aggregateCancelledOrders(cancelled);

    const dailyBreakdown = buildDailyBreakdown(completed);

    // ── Fetch returns for those orders (with processor info) ──
    const pdfReturns = orderIds.length > 0
      ? await Return.findAll({
          where: { orderId: orderIds, status: { [Op.not]: "CANCELLED" } },
          include: [
            {
              model: Order,
              as: "order",
              attributes: ["id", "orderNumber"],
            },
            {
              model: Product,
              as: "product",
              attributes: ["id", "name"],
            },
            {
              model: User,
              as: "processedByUser",
              attributes: ["id", "firstName", "lastName", "email"],
            },
          ],
          order: [["createdAt", "DESC"]],
        })
      : [];
    const returnsSummary = aggregateReturns(pdfReturns);

    // Net returns out of revenue for the PDF display.
    const mPdfTotalRefunded = Number(
      returnsSummary.reduce((s, r) => s + r.refundAmount, 0).toFixed(2)
    );
    const mPdfNetRevenue = Number((agg.totalRevenue - mPdfTotalRefunded).toFixed(2));

    // ── Build PDF ─────────────────────────────────────────
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    doc.registerFont("Khmer", KHMER_FONT);

    const filename = isRange
      ? `monthly-sales-${dateStr}.pdf`
      : `monthly-sales-${dateStr}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );

    // Crash-safety: same pattern as daily PDF — prevent server crash
    // if the stream errors mid-write.
    doc.on("error", (err) => {
      console.error("❌ Monthly PDF stream error:", err.message);
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: "PDF generation failed" });
      } else {
        res.end();
      }
    });
    res.on("close", () => {
      if (!doc.destroyed) doc.destroy();
    });

    doc.pipe(res);

    const primaryColor = "#1e40af";
    const accentColor  = "#3b82f6";
    const grayColor    = "#6b7280";
    const lightGray    = "#f3f4f6";
    const borderColor  = "#d1d5db";
    const successColor = "#16a34a";
    const warningColor = "#d97706";

    // ── Header ────────────────────────────────────────────
    doc.fontSize(22).font("Helvetica-Bold").fillColor(primaryColor)
       .text("LEVA Store", 40, 40);
    doc.fontSize(10).font("Helvetica").fillColor(grayColor)
       .text("Monthly Sales Report", 40, 68);
    let periodLabel;
    if (isRange) {
      const from = dayjs(rangeStart).format("MMMM D, YYYY");
      const to   = dayjs(rangeEnd).format("MMMM D, YYYY");
      periodLabel = `Period: ${from} – ${to}`;
    } else {
      periodLabel = `Period: ${dayjs(dateStr).format("MMMM YYYY")}`;
    }
    doc.fontSize(9).fillColor(grayColor)
       .text(periodLabel, 40, 84);

    doc.moveTo(40, 100).lineTo(545, 100)
       .lineWidth(1.5).strokeColor(accentColor).stroke();

    // ── Summary Section ───────────────────────────────────
    let y = 120;

    doc.fontSize(13).font("Helvetica-Bold").fillColor(primaryColor)
       .text("Summary", 40, y);
    y += 22;

    const boxH = 52, gap = 12, startX = 40;
    const summaryItems = [
      { label: "Total Revenue",  value: `$${mPdfNetRevenue.toFixed(2)}`,   color: successColor },
      { label: "Transactions",   value: String(completed.length),             color: accentColor },
      { label: "Items Sold",     value: String(agg.totalItemsSold),           color: warningColor },
      { label: "Discount",       value: `$${agg.totalDiscount.toFixed(2)}`,  color: "#d97706" },
    ];

    if (agg.totalRielKhr > 0) {
      summaryItems.push({
        label: "Riel (៛)",
        value: `៛${Math.round(agg.totalRielKhr).toLocaleString("en-US")}`,
        color: "#0f766e",
      });
    }

    const boxW = Math.min(120, (505 - gap * (summaryItems.length - 1)) / summaryItems.length);

    summaryItems.forEach((item, i) => {
      const x = startX + i * (boxW + gap);
      const isRiel = item.label.includes("Riel");
      const labelFont = isRiel ? "Khmer" : "Helvetica";
      const valueFont = isRiel ? "Khmer" : "Helvetica-Bold";
      doc.roundedRect(x, y, boxW, boxH, 6).fillColor("#f8fafc").fill()
         .roundedRect(x, y, boxW, boxH, 6).lineWidth(1).strokeColor(borderColor).stroke();
      doc.fontSize(10).font(labelFont).fillColor(grayColor)
         .text(item.label, x + 10, y + 8, { width: boxW - 20, align: "center" });
      doc.fontSize(14).font(valueFont).fillColor(item.color)
         .text(item.value, x + 10, y + 24, { width: boxW - 20, align: "center" });
    });

    y += boxH + 20;

    // ── Payment Method Breakdown ──────────────────────────
    doc.fontSize(13).font("Helvetica-Bold").fillColor(primaryColor)
       .text("Payment Method Breakdown", 40, y);
    y += 22;

    const methodColors = {
      CASH: "#16a34a", ABA_PAYWAY: "#2563eb", KHQR: "#d97706", OTHER: "#6b7280",
    };

    for (const [method, amount] of Object.entries(agg.paymentMethodBreakdown)) {
      const displayName = method === "ABA_PAYWAY" ? "ABA PayWay"
                        : method.charAt(0) + method.slice(1).toLowerCase();
      const amountNum = Number(amount) || 0;

      doc.roundedRect(40, y, 505, 24, 4).fillColor(lightGray).fill();
      doc.fontSize(10).font("Helvetica").fillColor(grayColor)
         .text(displayName, 50, y + 6);
      doc.fontSize(10).font("Helvetica-Bold").fillColor(methodColors[method] || grayColor)
         .text(`$${amountNum.toFixed(2)}`, 480, y + 6, { align: "right" });
      y += 30;
    }

    if (agg.totalRielKhr > 0) {
      doc.roundedRect(40, y, 505, 24, 4).fillColor("#ccfbf1").fill();
      doc.fontSize(10).font("Khmer").fillColor("#0f766e")
         .text("Riel (៛)", 50, y + 6);
      doc.fontSize(10).font("Khmer").fillColor("#0f766e")
         .text(`៛${Math.round(agg.totalRielKhr).toLocaleString("en-US")}`, 480, y + 6, { align: "right" });
      y += 30;
    }

    // Cancelled orders summary (separate from revenue)
    if (cancelledSummary.count > 0) {
      y += 10;
      doc.fontSize(13).font("Helvetica-Bold").fillColor(primaryColor)
         .text("Cancelled Orders", 40, y);
      y += 22;

      const cancelledBoxes = [
        { label: "Cancelled", value: String(cancelledSummary.count), color: "#ef4444" },
        { label: "Cancelled Value", value: `$${cancelledSummary.totalValue.toFixed(2)}`, color: "#ef4444" },
        { label: "Items Cancelled", value: String(cancelledSummary.totalItems), color: "#ef4444" },
      ];

      const cBoxW = Math.min(120, (505 - gap * (cancelledBoxes.length - 1)) / cancelledBoxes.length);
      cancelledBoxes.forEach((item, i) => {
        const x = startX + i * (cBoxW + gap);
        doc.roundedRect(x, y, cBoxW, boxH, 6).fillColor("#fef2f2").fill()
           .roundedRect(x, y, cBoxW, boxH, 6).lineWidth(1).strokeColor("#fecaca").stroke();
        doc.fontSize(10).font("Helvetica").fillColor(grayColor)
           .text(item.label, x + 10, y + 8, { width: cBoxW - 20, align: "center" });
        doc.fontSize(14).font("Helvetica-Bold").fillColor(item.color)
           .text(item.value, x + 10, y + 24, { width: cBoxW - 20, align: "center" });
      });
      y += boxH + 20;
    }

    // Returns section
    if (returnsSummary.length > 0) {
      y += 10;
      doc.fontSize(13).font("Helvetica-Bold").fillColor("#7c3aed")
         .text("Returns", 40, y);
      y += 22;

      const returnBoxes = [
        { label: "Returns", value: String(returnsSummary.length), color: "#7c3aed" },
        { label: "Total Refunded", value: `$${returnsSummary.reduce((s, r) => s + r.refundAmount, 0).toFixed(2)}`, color: "#7c3aed" },
      ];

      const rBoxW = Math.min(120, (505 - gap * (returnBoxes.length - 1)) / returnBoxes.length);
      returnBoxes.forEach((item, i) => {
        const x = startX + i * (rBoxW + gap);
        doc.roundedRect(x, y, rBoxW, boxH, 6).fillColor("#f5f3ff").fill()
           .roundedRect(x, y, rBoxW, boxH, 6).lineWidth(1).strokeColor("#ddd6fe").stroke();
        doc.fontSize(10).font("Helvetica").fillColor(grayColor)
           .text(item.label, x + 10, y + 8, { width: rBoxW - 20, align: "center" });
        doc.fontSize(14).font("Helvetica-Bold").fillColor(item.color)
           .text(item.value, x + 10, y + 24, { width: rBoxW - 20, align: "center" });
      });
      y += boxH + 20;
    }

    y += 10;

    // ── Returns Table ─────────────────────────────────────
    if (returnsSummary.length > 0) {
      doc.fontSize(13).font("Helvetica-Bold").fillColor("#7c3aed")
         .text("Returns", 40, y);
      y += 22;

      const rColX = [40, 100, 260, 370, 430, 510];
      const rColW = [60, 160, 110, 60, 80, 35];
      const rHeaders = ["#", "Order No.", "Product", "Qty", "Processed By", "Method"];

      doc.roundedRect(40, y, 505, 20, 4).fillColor("#7c3aed").fill();
      doc.fontSize(9).font("Helvetica-Bold").fillColor("#ffffff");
      rHeaders.forEach((h, i) => {
        doc.text(h, rColX[i] + 4, y + 4, { width: rColW[i], align: i < 2 ? "left" : "center" });
      });
      y += 26;

      doc.fontSize(8).font("Helvetica");
      for (let i = 0; i < Math.min(returnsSummary.length, 20); i++) {
        const r = returnsSummary[i];
        if (i % 2 === 0) {
          doc.roundedRect(40, y, 505, 18, 3).fillColor("#faf5ff").fill();
        }
        doc.fillColor("#111827");
        doc.text(String(i + 1),              rColX[0] + 4, y + 4, { width: rColW[0], align: "center" });
        doc.text(r.orderNumber || "",        rColX[1] + 4, y + 4, { width: rColW[1] });
        doc.text(r.productName || "—",       rColX[2] + 4, y + 4, { width: rColW[2] });
        doc.text(String(r.quantity),         rColX[3] + 4, y + 4, { width: rColW[3], align: "center" });
        doc.text(r.processedBy || "Unknown", rColX[4] + 4, y + 4, { width: rColW[4] });
        doc.text(r.refundMethod || "Cash",   rColX[5] + 4, y + 4, { width: rColW[5], align: "center" });
        y += 22;

        if (y > 750) {
          doc.addPage();
          y = 40;
        }
      }
    }

    // ── Daily Subtotals Table ─────────────────────────────
    doc.fontSize(13).font("Helvetica-Bold").fillColor(primaryColor)
       .text("Daily Subtotals", 40, y);
    y += 22;

    const colX = [40, 130, 230, 310, 390, 465];
    const colW = [90, 100, 80, 80, 75, 80];
    const headers = ["Date", "Orders", "Items", "Sales", "Discount", "Method"];

    doc.roundedRect(40, y, 505, 20, 4).fillColor(primaryColor).fill();
    doc.fontSize(9).font("Helvetica-Bold").fillColor("#ffffff");
    headers.forEach((h, i) => {
      doc.text(h, colX[i] + 4, y + 4, { width: colW[i], align: i === 0 ? "left" : "center" });
    });
    y += 26;

    // Build per-day payment method breakdown from completed orders
    const dayMethodBreakdown = {};
    for (const order of completed) {
      const day = dayjs(order.createdAt).format("YYYY-MM-DD");
      if (!dayMethodBreakdown[day]) dayMethodBreakdown[day] = { CASH: 0, ABA_PAYWAY: 0, KHQR: 0, OTHER: 0 };
      const method = getPaymentMethod(paymentMap, order.id);
      dayMethodBreakdown[day][method] += Number(order.total) || 0;
    }

    doc.fontSize(8).font("Helvetica");
    for (let i = 0; i < dailyBreakdown.length; i++) {
      const d = dailyBreakdown[i];
      const dayDate = dayjs(d.date).format("MMM D, YYYY");
      const dayMethods = dayMethodBreakdown[d.date] || { CASH: 0, ABA_PAYWAY: 0, KHQR: 0, OTHER: 0 };
      const topMethod = Object.entries(dayMethods).sort((a, b) => (b[1] || 0) - (a[1] || 0))[0];
      const methodLabel = topMethod && topMethod[1] > 0
        ? (topMethod[0] === "ABA_PAYWAY" ? "ABA PayWay" : topMethod[0].charAt(0) + topMethod[0].slice(1).toLowerCase())
        : "—";

      if (i % 2 === 0) {
        doc.roundedRect(40, y, 505, 18, 3).fillColor("#f9fafc").fill();
      }

      doc.fillColor("#111827");
      doc.text(dayDate,                    colX[0] + 4, y + 4, { width: colW[0] });
      doc.text(String(d.orders),            colX[1] + 4, y + 4, { width: colW[1], align: "center" });
      doc.text(String(d.totalItemsSold),    colX[2] + 4, y + 4, { width: colW[2], align: "center" });
      doc.text(`$${d.totalSales.toFixed(2)}`,  colX[3] + 4, y + 4, { width: colW[3], align: "right" });
      doc.text(`$${d.totalDiscount.toFixed(2)}`, colX[4] + 4, y + 4, { width: colW[4], align: "right" });
      doc.text(methodLabel,                colX[5] + 4, y + 4, { width: colW[5], align: "center" });
      y += 20;

      if (y > 750) {
        doc.addPage();
        y = 40;
      }
    }

    // ── Footer ────────────────────────────────────────────
    const remainingHeight = doc.page.height - y;
    if (remainingHeight < 50) { doc.addPage(); y = 40; }
    y = Math.max(y, doc.page.height - 80);

    doc.moveTo(40, y).lineTo(545, y)
       .lineWidth(1).strokeColor(borderColor).stroke();
    doc.fontSize(8).font("Helvetica").fillColor(grayColor)
       .text(
         `Generated on ${dayjs().format("MMMM D, YYYY [at] h:mm A")} — LEVA Store POS System`,
         40, y + 8, { align: "center" }
       );

    doc.end();
  } catch (error) {
    console.error("❌ Monthly sales PDF error:", error.message);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
});

// ─── GET: Stock Aging Report (admin only) ────────────────────
// Returns all ProductBatch rows with qty > 0, sorted by receivedDate ASC
// (oldest stock first). Includes computed daysInStock and daysUntilExpiry.
// Supports optional filters: minDaysInStock, productId, startDate, endDate.
router.get("/aging", requireRole("admin"), async (req, res) => {
  try {
    const minDaysInStock = Number(req.query.minDaysInStock) || 0;
    const productIdFilter = req.query.productId
      ? Number(req.query.productId)
      : null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);

    const whereClause = { qty: { [Op.gt]: 0 } };

    if (productIdFilter) {
      whereClause.productId = productIdFilter;
    }

    if (req.query.startDate || req.query.endDate) {
      const dateRange = {};
      if (req.query.startDate) {
        dateRange[Op.gte] = req.query.startDate;
      }
      if (req.query.endDate) {
        dateRange[Op.lte] = req.query.endDate;
      }
      whereClause.receivedDate = dateRange;
    }

    const batches = await ProductBatch.findAll({
      where: whereClause,
      order: [["receivedDate", "ASC"], ["expireDate", "ASC NULLS LAST"]],
      include: [
        {
          model: Product,
          as: "product",
          attributes: ["id", "name", "sku", "price"],
        },
      ],
    });

    // Compute derived fields: daysInStock and daysUntilExpiry
    const data = batches
      .map((batch) => {
        const received = new Date(`${batch.receivedDate}T00:00:00`);
        const daysInStock = Math.floor((today - received) / 86_400_000);

        let daysUntilExpiry = null;
        if (batch.expireDate) {
          const expire = new Date(`${batch.expireDate}T00:00:00`);
          daysUntilExpiry = Math.ceil((expire - today) / 86_400_000);
        }

        return {
          id: batch.id,
          productId: batch.productId,
          productName: batch.product?.name,
          sku: batch.product?.sku,
          batchNumber: batch.batchNumber,
          qty: Number(batch.qty),
          costPrice: batch.costPrice != null ? Number(batch.costPrice) : null,
          receivedDate: batch.receivedDate,
          expireDate: batch.expireDate,
          daysInStock,
          daysUntilExpiry,
        };
      })
      .filter((row) => row.daysInStock >= minDaysInStock);

    // Summary stats
    const totalBatches = data.length;
    const totalQty = data.reduce((s, r) => s + r.qty, 0);
    const avgDaysInStock =
      totalBatches > 0
        ? Math.round(data.reduce((s, r) => s + r.daysInStock, 0) / totalBatches)
        : 0;
    const oldestBatch = data.length > 0 ? data[0] : null;
    const nearExpiryCount = data.filter(
      (r) => r.daysUntilExpiry !== null && r.daysUntilExpiry <= 7 && r.daysUntilExpiry >= 0
    ).length;

    res.json({
      success: true,
      summary: {
        totalBatches,
        totalQty,
        avgDaysInStock,
        oldestBatch,
        nearExpiryCount,
        filters: {
          minDaysInStock,
          productId: productIdFilter,
          startDate: req.query.startDate || null,
          endDate: req.query.endDate || null,
        },
      },
      data,
    });
  } catch (error) {
    console.error("Stock aging report error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
