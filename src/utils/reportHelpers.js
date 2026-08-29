/**
 * Shared helpers for daily/monthly sales reports.
 *
 * All functions in this file are pure data transformers — they take
 * Sequelize model instances and return plain JS objects/numbers so
 * the report routes stay thin.
 */

const dayjs = require("dayjs");

/**
 * Build a lookup map of orderId → Payment for the given payments array.
 * When an order has multiple payments, only the first (earliest-created)
 * is kept so the report attributes each order to exactly one method.
 */
function buildPaymentMap(payments) {
  const map = {};
  for (const p of payments) {
    if (!map[p.orderId]) map[p.orderId] = p;
  }
  return map;
}

/**
 * Resolve the display-name payment method for an order given the
 * payment map. Returns one of: "CASH", "ABA_PAYWAY", "KHQR", "OTHER".
 */
function getPaymentMethod(paymentMap, orderId) {
  const payment = paymentMap[orderId];
  if (!payment) return "OTHER";
  const raw = (payment.method || "").toUpperCase();
  if (raw === "CASH") return "CASH";
  if (raw === "ABA_PAYWAY" || raw === "ABA") return "ABA_PAYWAY";
  if (raw === "KHQR" || raw.includes("KHQR")) return "KHQR";
  return "OTHER";
}

/**
 * Split an orders array into completed, cancelled, and pending buckets.
 * Only completed orders count as revenue; cancelled orders are tracked
 * separately for the cancellation summary.
 */
function splitOrdersByStatus(orders) {
  const completed = [];
  const cancelled = [];
  const pending = [];
  for (const order of orders) {
    if (order.status === "completed") completed.push(order);
    else if (order.status === "cancelled") cancelled.push(order);
    else pending.push(order);
  }
  return { completed, cancelled, pending };
}

/**
 * Aggregate metrics for a set of completed orders.
 *
 * @param {Array} completedOrders - orders with status === "completed"
 * @param {Object} paymentMap - orderId → Payment mapping
 * @returns {Object} metrics including revenue, items sold, method breakdown, transaction list
 */
function aggregateCompletedOrders(completedOrders, paymentMap) {
  const paymentMethodBreakdown = { CASH: 0, ABA_PAYWAY: 0, KHQR: 0, OTHER: 0 };
  let totalRevenue = 0;
  let totalDiscount = 0;
  let grossSales = 0;
  let totalItemsSold = 0;
  let totalRielKhr = 0;
  const transactions = [];

  for (const order of completedOrders) {
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

    const method = getPaymentMethod(paymentMap, order.id);
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

  return {
    paymentMethodBreakdown,
    totalRevenue,
    totalDiscount,
    grossSales,
    totalItemsSold,
    totalRielKhr,
    transactions,
    totalRefunded: 0,
  };
}

/**
 * Compute cancellation summary from cancelled orders.
 */
function aggregateCancelledOrders(cancelledOrders) {
  const count = cancelledOrders.length;
  const totalValue = cancelledOrders.reduce(
    (sum, o) => sum + (Number(o.total) || 0), 0
  );
  const totalItems = cancelledOrders.reduce(
    (sum, o) => sum + (o.orderDetails || []).reduce((s, d) => s + (Number(d.qty) || 0), 0),
    0
  );
  return { count, totalValue, totalItems };
}

/**
 * Build a daily breakdown array from completed orders.
 * Groups completed orders by date and accumulates totals per day.
 *
 * @param {Array} completedOrders - orders with status === "completed"
 * @returns {Array} sorted array of { date, orders, totalSales, totalDiscount, totalItemsSold }
 */
function buildDailyBreakdown(completedOrders) {
  const dayMap = {};
  for (const order of completedOrders) {
    const orderTotal = Number(order.total) || 0;
    const orderDiscount = Number(order.discount) || 0;
    const itemsCount = (order.orderDetails || []).reduce(
      (sum, d) => sum + (Number(d.qty) || 0), 0
    );
    const day = dayjs(order.createdAt).format("YYYY-MM-DD");
    if (!dayMap[day]) dayMap[day] = { date: day, orders: 0, totalSales: 0, totalDiscount: 0, totalItemsSold: 0 };
    dayMap[day].orders++;
    dayMap[day].totalSales += orderTotal;
    dayMap[day].totalDiscount += orderDiscount;
    dayMap[day].totalItemsSold += itemsCount;
  }
  return Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Build a per-return summary array for the report's Returns section.
 *
 * @param {Array} returns - Return model instances (ideally with processedByUser included)
 * @returns {Array} sorted array of plain objects keyed for JSON + PDF rendering
 */
function aggregateReturns(returns) {
  return returns
    .filter((r) => r && r.status !== "CANCELLED")
    .map((r) => {
      const processor = r.processedByUser || {};
      return {
        id:            r.id,
        orderId:       r.orderId,
        orderNumber:   r.order?.orderNumber || `#${r.orderId}`,
        productName:   r.product?.name || "—",
        quantity:      Number(r.quantity) || 0,
        refundAmount:  Number(r.refundAmount) || 0,
        refundMethod:  r.refundMethod || "Cash",
        reason:        r.reason || "",
        processedBy:   processor
          ? `${processor.firstName || ""} ${processor.lastName || ""}`.trim() || processor.email || "Unknown"
          : "Unknown",
        createdAt:     r.createdAt,
      };
    })
    .sort((a, b) => (a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : 0));
}

module.exports = {
  buildPaymentMap,
  getPaymentMethod,
  splitOrdersByStatus,
  aggregateCompletedOrders,
  aggregateCancelledOrders,
  buildDailyBreakdown,
  aggregateReturns,
};
