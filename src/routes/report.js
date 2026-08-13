const express = require("express");
const { Order, OrderDetail, Payment, sequelize } = require("../../models");
const { Op, fn, col } = require("sequelize");
const PDFDocument = require("pdfkit");
const dayjs = require("dayjs");
const { requireRole } = require("../../middlewares/requireRole");

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

    // ── Fetch all orders for the date (any status) ──────────
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

    // Build a payment map: orderId → payment
    const paymentMap = {};
    for (const p of payments) {
      // For orders with multiple payments, keep only the first/primary
      if (!paymentMap[p.orderId]) paymentMap[p.orderId] = p;
    }

    // ── Aggregate ──────────────────────────────────────────
    const paymentMethodBreakdown = { CASH: 0, ABA_PAYWAY: 0, KHQR: 0, OTHER: 0 };
    let totalRevenue = 0;      // net amount actually collected (after discounts)
    let totalDiscount = 0;     // total customer savings (manual + per-product)
    let grossSales = 0;        // revenue before any discount
    let totalItemsSold = 0;
    let totalRielKhr = 0;      // total Riel collected (from orders charged in KHR)
    const transactions = [];

    for (const order of orders) {
      const orderTotal = Number(order.total) || 0;
      const orderDiscount = Number(order.discount) || 0;
      totalRevenue += orderTotal;
      totalDiscount += orderDiscount;
      grossSales += orderTotal + orderDiscount;
      // KHR orders store the exact Riel amount paid at order create.
      totalRielKhr += Number(order.amountKhr) || 0;

      const itemsCount = (order.orderDetails || []).reduce(
        (sum, d) => sum + (Number(d.qty) || 0), 0
      );
      totalItemsSold += itemsCount;

      // Bucket into payment method; orders without a payment record fall
      // into OTHER so every order's total is accounted for exactly once.
      const payment = paymentMap[order.id];
      let method = "OTHER";
      if (payment) {
        const raw = (payment.method || "").toUpperCase();
        if (raw === "CASH") method = "CASH";
        else if (raw === "ABA_PAYWAY" || raw === "ABA") method = "ABA_PAYWAY";
        else if (raw === "KHQR" || raw.includes("KHQR")) method = "KHQR";
        else method = "OTHER";
      }
      paymentMethodBreakdown[method] =
        (paymentMethodBreakdown[method] || 0) + orderTotal;

      transactions.push({
        id: order.id,
        orderNumber: order.orderNumber,
        time: order.createdAt,
        itemsCount,
        total: orderTotal,
        discount: orderDiscount,
        paymentMethod: method,
      });
    }

    const totalTransactions = orders.length;

    // Rate used to convert KHR → USD equivalent on the frontend Riel card.
    const usdToKhrRate = Number(process.env.ABA_PAYWAY_KHR_RATE) || 4100;

    res.json({
      success: true,
      date,
      summary: {
        totalRevenue: Number(totalRevenue.toFixed(2)),
        totalTransactions,
        totalItemsSold,
        grossSales: Number(grossSales.toFixed(2)),
        totalDiscount: Number(totalDiscount.toFixed(2)),
        netSales: Number(totalRevenue.toFixed(2)),
        rielKhr: Number(totalRielKhr.toFixed(0)),
        usdToKhrRate,
        paymentMethodBreakdown,
      },
      transactions,
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

    const paymentMap = {};
    for (const p of payments) {
      if (!paymentMap[p.orderId]) paymentMap[p.orderId] = p;
    }

    const paymentMethodBreakdown = { CASH: 0, ABA_PAYWAY: 0, KHQR: 0, OTHER: 0 };
    let totalRevenue = 0;      // net amount actually collected (after discounts)
    let totalDiscount = 0;     // total customer savings (manual + per-product)
    let totalItemsSold = 0;
    let totalRielKhr = 0;      // total Riel collected (from orders charged in KHR)

    for (const order of orders) {
      const orderTotal = Number(order.total) || 0;
      const orderDiscount = Number(order.discount) || 0;
      totalRevenue += orderTotal;
      totalDiscount += orderDiscount;
      totalItemsSold += (order.orderDetails || []).reduce(
        (sum, d) => sum + (Number(d.qty) || 0), 0
      );
      totalRielKhr += Number(order.amountKhr) || 0;

      const payment = paymentMap[order.id];
      let method = "OTHER";
      if (payment) {
        const raw = (payment.method || "").toUpperCase();
        if (raw === "CASH") method = "CASH";
        else if (raw === "ABA_PAYWAY" || raw === "ABA") method = "ABA_PAYWAY";
        else if (raw === "KHQR" || raw.includes("KHQR")) method = "KHQR";
        else method = "OTHER";
      }
      paymentMethodBreakdown[method] =
        (paymentMethodBreakdown[method] || 0) + orderTotal;
    }

    // ── Build PDF ─────────────────────────────────────────
    const doc = new PDFDocument({ margin: 40, size: "A4" });

    // Set response headers
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="daily-sales-${date}.pdf"`
    );
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
      { label: "Total Revenue",  value: `$${totalRevenue.toFixed(2)}`,  color: successColor },
      { label: "Transactions",   value: String(orders.length),          color: accentColor },
      { label: "Items Sold",     value: String(totalItemsSold),         color: warningColor },
      { label: "Discount",       value: `$${totalDiscount.toFixed(2)}`, color: "#d97706" },
    ];

    // Only show the Riel summary box when any KHR was collected that day.
    if (totalRielKhr > 0) {
      summaryItems.push({
        label: "Riel (៛)",
        value: `៛${Math.round(totalRielKhr).toLocaleString("en-US")}`,
        color: "#0f766e",
      });
    }

    const boxW = Math.min(120, (505 - gap * (summaryItems.length - 1)) / summaryItems.length);

    summaryItems.forEach((item, i) => {
      const x = startX + i * (boxW + gap);
      doc.roundedRect(x, y, boxW, boxH, 6).fillColor("#f8fafc").fill()
         .roundedRect(x, y, boxW, boxH, 6).lineWidth(1).strokeColor(borderColor).stroke();
      doc.fontSize(10).font("Helvetica").fillColor(grayColor)
         .text(item.label, x + 10, y + 8, { width: boxW - 20, align: "center" });
      doc.fontSize(14).font("Helvetica-Bold").fillColor(item.color)
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

    for (const [method, amount] of Object.entries(paymentMethodBreakdown)) {
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
    if (totalRielKhr > 0) {
      doc.roundedRect(40, y, 505, 24, 4).fillColor("#ccfbf1").fill();
      doc.fontSize(10).font("Helvetica-Bold").fillColor("#0f766e")
         .text("Riel (៛)", 50, y + 6);
      doc.fontSize(10).font("Helvetica-Bold").fillColor("#0f766e")
         .text(`៛${Math.round(totalRielKhr).toLocaleString("en-US")}`, 480, y + 6, { align: "right" });
      y += 30;
    }

    y += 10;

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
    for (let i = 0; i < Math.min(orders.length, 30); i++) {
      const order = orders[i];
      const payment = paymentMap[order.id];
      let method = "OTHER";
      if (payment) {
        const raw = (payment.method || "").toUpperCase();
        if (raw === "CASH") method = "CASH";
        else if (raw === "ABA_PAYWAY" || raw === "ABA") method = "ABA";
        else if (raw === "KHQR" || raw.includes("KHQR")) method = "KHQR";
      }
      const itemsCount = (order.orderDetails || []).reduce(
        (sum, d) => sum + (Number(d.qty) || 0), 0
      );
      const orderDiscount = Number(order.discount) || 0;

      // Alternating row bg
      if (i % 2 === 0) {
        doc.roundedRect(40, y, 505, 18, 3).fillColor("#f9fafb").fill();
      }

      doc.fillColor("#111827");
      doc.text(String(i + 1),           colX[0] + 4, y + 4, { width: colW[0], align: "center" });
      doc.text(order.orderNumber || "", colX[1] + 4, y + 4, { width: colW[1] });
      doc.text(String(itemsCount),       colX[2] + 4, y + 4, { width: colW[2] });
      doc.text(`$${Number(order.total).toFixed(2)}`, colX[3] + 4, y + 4, { width: colW[3] });
      doc.text(`$${orderDiscount.toFixed(2)}`,        colX[4] + 4, y + 4, { width: colW[4] });
      doc.text(method,                   colX[5] + 4, y + 4, { width: colW[5] });
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
    const year  = Number(req.query.year)  || dayjs().year();
    const month = String(req.query.month || dayjs().month() + 1).padStart(2, "0");
    const dateStr = `${year}-${month}`;

    const monthStart = new Date(`${dateStr}-01T00:00:00.000Z`);
    const nextMonth   = new Date(monthStart);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);

    const orders = await Order.findAll({
      where: {
        createdAt: { [Op.gte]: monthStart, [Op.lt]: nextMonth },
      },
      include: [{ model: OrderDetail, as: "orderDetails" }],
      order: [["createdAt", "ASC"]],
    });

    const orderIds = orders.map((o) => o.id);
    const payments = orderIds.length > 0
      ? await Payment.findAll({ where: { orderId: orderIds } })
      : [];

    const paymentMap = {};
    for (const p of payments) {
      if (!paymentMap[p.orderId]) paymentMap[p.orderId] = p;
    }

    // ── Aggregate by day ────────────────────────────────────
    const dayMap = {};
    const paymentMethodBreakdown = { CASH: 0, ABA_PAYWAY: 0, KHQR: 0, OTHER: 0 };
    let totalRevenue = 0, totalDiscount = 0, grossSales = 0, totalItemsSold = 0, totalRielKhr = 0;

    for (const order of orders) {
      const orderTotal = Number(order.total) || 0;
      const orderDiscount = Number(order.discount) || 0;
      totalRevenue += orderTotal;
      totalDiscount += orderDiscount;
      grossSales += orderTotal + orderDiscount;
      totalRielKhr += Number(order.amountKhr) || 0;

      const itemsCount = (order.orderDetails || []).reduce(
        (sum, d) => sum + (Number(d.qty) || 0), 0
      );
      totalItemsSold += itemsCount;

      const day = dayjs(order.createdAt).format("YYYY-MM-DD");
      if (!dayMap[day]) dayMap[day] = { date: day, orders: 0, totalSales: 0, totalDiscount: 0, totalItemsSold: 0 };
      dayMap[day].orders++;
      dayMap[day].totalSales += orderTotal;
      dayMap[day].totalDiscount += orderDiscount;
      dayMap[day].totalItemsSold += itemsCount;

      const payment = paymentMap[order.id];
      let method = "OTHER";
      if (payment) {
        const raw = (payment.method || "").toUpperCase();
        if (raw === "CASH") method = "CASH";
        else if (raw === "ABA_PAYWAY" || raw === "ABA") method = "ABA_PAYWAY";
        else if (raw === "KHQR" || raw.includes("KHQR")) method = "KHQR";
        else method = "OTHER";
      }
      paymentMethodBreakdown[method] =
        (paymentMethodBreakdown[method] || 0) + orderTotal;
    }

    const dailyBreakdown = Object.values(dayMap).sort(
      (a, b) => a.date.localeCompare(b.date)
    );

    const usdToKhrRate = Number(process.env.ABA_PAYWAY_KHR_RATE) || 4100;

    res.json({
      success: true,
      date: dateStr,
      summary: {
        totalRevenue:   Number(totalRevenue.toFixed(2)),
        totalTransactions: orders.length,
        totalItemsSold,
        grossSales:     Number(grossSales.toFixed(2)),
        totalDiscount:  Number(totalDiscount.toFixed(2)),
        netSales:       Number(totalRevenue.toFixed(2)),
        rielKhr:        Number(totalRielKhr.toFixed(0)),
        usdToKhrRate,
        paymentMethodBreakdown,
      },
      dailyBreakdown,
    });
  } catch (error) {
    console.error("❌ Monthly sales report error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── GET: Download Monthly Sales Report PDF (admin only) ───
router.get("/monthly-sales/pdf", requireRole("admin"), async (req, res) => {
  try {
    const year  = Number(req.query.year)  || dayjs().year();
    const month = String(req.query.month || dayjs().month() + 1).padStart(2, "0");
    const dateStr = `${year}-${month}`;

    const monthStart = new Date(`${dateStr}-01T00:00:00.000Z`);
    const nextMonth   = new Date(monthStart);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);

    const orders = await Order.findAll({
      where: {
        createdAt: { [Op.gte]: monthStart, [Op.lt]: nextMonth },
      },
      include: [{ model: OrderDetail, as: "orderDetails" }],
      order: [["createdAt", "ASC"]],
    });

    const orderIds = orders.map((o) => o.id);
    const payments = orderIds.length > 0
      ? await Payment.findAll({ where: { orderId: orderIds } })
      : [];

    const paymentMap = {};
    for (const p of payments) {
      if (!paymentMap[p.orderId]) paymentMap[p.orderId] = p;
    }

    const paymentMethodBreakdown = { CASH: 0, ABA_PAYWAY: 0, KHQR: 0, OTHER: 0 };
    let totalRevenue = 0, totalDiscount = 0, totalItemsSold = 0, totalRielKhr = 0;

    const dayMap = {};
    for (const order of orders) {
      const orderTotal = Number(order.total) || 0;
      const orderDiscount = Number(order.discount) || 0;
      totalRevenue += orderTotal;
      totalDiscount += orderDiscount;
      totalItemsSold += (order.orderDetails || []).reduce(
        (sum, d) => sum + (Number(d.qty) || 0), 0
      );
      totalRielKhr += Number(order.amountKhr) || 0;

      const day = dayjs(order.createdAt).format("YYYY-MM-DD");
      if (!dayMap[day]) dayMap[day] = { date: day, orders: 0, totalSales: 0, totalDiscount: 0, totalItemsSold: 0 };
      dayMap[day].orders++;
      dayMap[day].totalSales += orderTotal;
      dayMap[day].totalDiscount += orderDiscount;
      dayMap[day].totalItemsSold += (order.orderDetails || []).reduce(
        (sum, d) => sum + (Number(d.qty) || 0), 0
      );

      const payment = paymentMap[order.id];
      let method = "OTHER";
      if (payment) {
        const raw = (payment.method || "").toUpperCase();
        if (raw === "CASH") method = "CASH";
        else if (raw === "ABA_PAYWAY" || raw === "ABA") method = "ABA_PAYWAY";
        else if (raw === "KHQR" || raw.includes("KHQR")) method = "KHQR";
        else method = "OTHER";
      }
      paymentMethodBreakdown[method] =
        (paymentMethodBreakdown[method] || 0) + orderTotal;
    }

    const dailyBreakdown = Object.values(dayMap).sort(
      (a, b) => a.date.localeCompare(b.date)
    );

    // ── Build PDF ─────────────────────────────────────────
    const doc = new PDFDocument({ margin: 40, size: "A4" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="monthly-sales-${dateStr}.pdf"`
    );
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
    doc.fontSize(9).fillColor(grayColor)
       .text(
         `Period: ${dayjs(dateStr).format("MMMM YYYY")}`,
         40, 84
       );

    doc.moveTo(40, 100).lineTo(545, 100)
       .lineWidth(1.5).strokeColor(accentColor).stroke();

    // ── Summary Section ───────────────────────────────────
    let y = 120;

    doc.fontSize(13).font("Helvetica-Bold").fillColor(primaryColor)
       .text("Summary", 40, y);
    y += 22;

    const boxH = 52, gap = 12, startX = 40;
    const summaryItems = [
      { label: "Total Revenue",  value: `$${totalRevenue.toFixed(2)}`,   color: successColor },
      { label: "Transactions",   value: String(orders.length),            color: accentColor },
      { label: "Items Sold",     value: String(totalItemsSold),           color: warningColor },
      { label: "Discount",       value: `$${totalDiscount.toFixed(2)}`,  color: "#d97706" },
    ];

    if (totalRielKhr > 0) {
      summaryItems.push({
        label: "Riel (៛)",
        value: `៛${Math.round(totalRielKhr).toLocaleString("en-US")}`,
        color: "#0f766e",
      });
    }

    const boxW = Math.min(120, (505 - gap * (summaryItems.length - 1)) / summaryItems.length);

    summaryItems.forEach((item, i) => {
      const x = startX + i * (boxW + gap);
      doc.roundedRect(x, y, boxW, boxH, 6).fillColor("#f8fafc").fill()
         .roundedRect(x, y, boxW, boxH, 6).lineWidth(1).strokeColor(borderColor).stroke();
      doc.fontSize(10).font("Helvetica").fillColor(grayColor)
         .text(item.label, x + 10, y + 8, { width: boxW - 20, align: "center" });
      doc.fontSize(14).font("Helvetica-Bold").fillColor(item.color)
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

    for (const [method, amount] of Object.entries(paymentMethodBreakdown)) {
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

    if (totalRielKhr > 0) {
      doc.roundedRect(40, y, 505, 24, 4).fillColor("#ccfbf1").fill();
      doc.fontSize(10).font("Helvetica-Bold").fillColor("#0f766e")
         .text("Riel (៛)", 50, y + 6);
      doc.fontSize(10).font("Helvetica-Bold").fillColor("#0f766e")
         .text(`៛${Math.round(totalRielKhr).toLocaleString("en-US")}`, 480, y + 6, { align: "right" });
      y += 30;
    }

    y += 10;

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

    doc.fontSize(8).font("Helvetica");
    for (let i = 0; i < Math.min(dailyBreakdown.length, 31); i++) {
      const d = dailyBreakdown[i];
      const dayDate = dayjs(d.date).format("MMM D, YYYY");
      const methodLabel = paymentMethodBreakdown[d.date]
        ? Object.entries(paymentMethodBreakdown).find(([_, v]) => v === d.totalSales)?.[0] || "—"
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

module.exports = router;
