/**
 * Quick verification script for the three changes:
 * 1. batchStock.js - deductStockFifo now has expiry filter
 * 2. report.js - aging endpoint exists with correct structure
 * 3. dashboard.js - nearExpiryCount and oldStockCount in summary
 *
 * Run: node verify-changes.js
 */

const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}`);
    failed++;
  }
}

// ─── 1. batchStock.js: deductStockFifo has expiry filter ─────────
console.log("\n1. batchStock.js — deductStockFifo expiry filter");
const batchStockPath = path.join(__dirname, "src", "utils", "batchStock.js");
const batchStockSrc = fs.readFileSync(batchStockPath, "utf8");

// Must contain the todayStr calculation inside deductStockFifo
assert(
  batchStockSrc.includes("async function deductStockFifo(productId, qty, { transaction } = {}) {"),
  "deductStockFifo function exists"
);

// Find the deductStockFifo function body (from signature to next top-level function)
const sigIdx = batchStockSrc.indexOf("async function deductStockFifo");
const nextFuncIdx = batchStockSrc.indexOf("\nasync function", sigIdx + 1);
const dfifoBody = nextFuncIdx > -1 ? batchStockSrc.slice(sigIdx, nextFuncIdx) : batchStockSrc.slice(sigIdx);
assert(dfifoBody.includes("todayStr"), "deductStockFifo computes todayStr");
assert(dfifoBody.includes("[Op.or]:"), "deductStockFifo has Op.or filter");
assert(
  dfifoBody.includes("expireDate: { [Op.gte]: todayStr }"),
  "deductStockFifo filters expireDate >= today"
);
assert(
  dfifoBody.includes("expireDate: null"),
  "deductStockFifo includes null expireDate batches"
);

// ─── 2. report.js: aging endpoint ─────────────────────────────
console.log("\n2. report.js — aging endpoint");
const reportPath = path.join(__dirname, "src", "routes", "report.js");
const reportSrc = fs.readFileSync(reportPath, "utf8");

assert(reportSrc.includes("requireRole(\"admin\")"), "Aging endpoint protected by admin role");
assert(reportSrc.includes('router.get("/aging"'), "Aging route registered");
assert(reportSrc.includes("ProductBatch"), "Aging endpoint imports ProductBatch");
assert(reportSrc.includes("receivedDate"), "Aging endpoint uses receivedDate");
assert(reportSrc.includes("daysInStock"), "Aging endpoint computes daysInStock");
assert(reportSrc.includes("daysUntilExpiry"), "Aging endpoint computes daysUntilExpiry");
assert(reportSrc.includes("minDaysInStock"), "Aging endpoint supports minDaysInStock filter");
assert(reportSrc.includes("productIdFilter"), "Aging endpoint supports productId filter");
assert(reportSrc.includes("req.query.startDate"), "Aging endpoint supports startDate filter");
assert(reportSrc.includes("req.query.endDate"), "Aging endpoint supports endDate filter");
assert(
  reportSrc.includes('order: [["receivedDate", "ASC"]'),
  "Aging endpoint sorts by receivedDate ASC"
);
assert(reportSrc.includes("totalBatches"), "Aging endpoint returns totalBatches summary");
assert(reportSrc.includes("avgDaysInStock"), "Aging endpoint returns avgDaysInStock summary");
assert(reportSrc.includes("nearExpiryCount"), "Aging endpoint returns nearExpiryCount in summary");

// ─── 3. dashboard.js: nearExpiryCount and oldStockCount ────────
console.log("\n3. dashboard.js — summary widgets");
const dashboardPath = path.join(__dirname, "src", "routes", "dashboard.js");
const dashboardSrc = fs.readFileSync(dashboardPath, "utf8");

assert(dashboardSrc.includes("ProductBatch"), "Dashboard imports ProductBatch");
assert(dashboardSrc.includes("nearExpiryCount"), "Dashboard destructures nearExpiryCount");
assert(dashboardSrc.includes("oldStockCount"), "Dashboard destructures oldStockCount");
assert(
  dashboardSrc.includes("expireDate: { [Op.ne]: null, [Op.between]"),
  "nearExpiryCount query filters expireDate with between and not-null"
);
assert(
  dashboardSrc.includes("receivedDate: { [Op.lte]:"),
  "oldStockCount query filters receivedDate <= 30 days ago"
);
assert(
  dashboardSrc.includes("nearExpiryCount") && dashboardSrc.includes("oldStockCount"),
  "Dashboard response includes nearExpiryCount and oldStockCount"
);

// ─── 4. product.js: inline stock-out has expiry filter ────────
console.log("\n4. product.js — stock-out endpoint expiry filter");
const productPath = path.join(__dirname, "src", "routes", "product.js");
const productSrc = fs.readFileSync(productPath, "utf8");

// Find the stock-out section
const stockOutMatch = productSrc.match(/PATCH: Stock Out[\s\S]*?res\.json\([\s\S]*?success: true/);
if (stockOutMatch) {
  const stockOutSection = stockOutMatch[0];
  assert(
    stockOutSection.includes("todayStr"),
    "Stock-out endpoint computes todayStr"
  );
  assert(
    stockOutSection.includes("[Op.or]:"),
    "Stock-out endpoint has Op.or filter"
  );
  assert(
    stockOutSection.includes("expireDate: { [Op.gte]: todayStr }"),
    "Stock-out endpoint filters expired batches"
  );
} else {
  assert(false, "Could not find stock-out endpoint section");
}

// ─── Summary ──────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log("All verification checks passed.");
}
