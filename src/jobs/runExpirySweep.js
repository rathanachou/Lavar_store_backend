/**
 * Production expiry sweep runner.
 *
 * Calls processExpiredBatches() against the production database and
 * reports exactly what was changed. Does NOT restore state afterward.
 *
 * Usage: node src/jobs/runExpirySweep.js
 */
require("dotenv").config();
const { sequelize } = require("../../models");
const { processExpiredBatches, syncProductFromBatches } = require("../utils/batchStock");
const { ProductBatch, Product, StockMovement, Inventory } = require("../../models");
const { Op } = require("sequelize");

async function main() {
  // ── Pre-flight: snapshot current state ───────────────────────
  console.log("=== PRE-SWEEP SNAPSHOT ===\n");

  // Batches that SHOULD be swept (expired, qty>0, not yet flagged)
  const pending = await ProductBatch.findAll({
    where: {
      qty: { [Op.gt]: 0 },
      expireDate: { [Op.lt]: new Date().toISOString().slice(0, 10) },
      expiredMovementCreated: false,
    },
    include: [{ model: Product, as: "product", attributes: ["id", "name", "qty"] }],
    order: [["id", "ASC"]],
  });

  console.log(`Expired batches pending sweep: ${pending.length}`);
  if (pending.length > 0) {
    for (const b of pending) {
      const p = b.product;
      console.log(
        `  batch #${b.id} | product=${p?.name ?? "?"} (id=${b.productId}) | ` +
          `qty=${b.qty} | expire=${b.expireDate}`
      );
    }
  }

  // Products with qty drift
  const allProducts = await Product.findAll({ order: [["id", "ASC"]] });
  const driftProducts = [];
  for (const product of allProducts) {
    const batchSum = await ProductBatch.findAll({
      where: {
        productId: product.id,
        qty: { [Op.gt]: 0 },
        [Op.or]: [{ expireDate: null }, { expireDate: { [Op.gte]: new Date().toISOString().slice(0, 10) } }],
      },
      attributes: [[sequelize.fn("SUM", sequelize.col("qty")), "total"]],
      raw: true,
    });
    const liveQty = Number(batchSum[0]?.total || 0);
    if (product.qty !== liveQty) {
      driftProducts.push({ id: product.id, name: product.name, productQty: product.qty, liveQty });
    }
  }

  console.log(`\nProducts with qty drift before sweep: ${driftProducts.length}`);
  for (const d of driftProducts) {
    console.log(`  product #${d.id} "${d.name}" | Product.qty=${d.productQty} | live=${d.liveQty} | drift=${d.productQty - d.liveQty}`);
  }

  if (pending.length === 0) {
    console.log("\nNothing to sweep — exiting.");
    await sequelize.close();
    return;
  }

  // ── Run the sweep ─────────────────────────────────────────────
  console.log("\n=== RUNNING SWEEP ===\n");
  const t0 = Date.now();
  const result = await processExpiredBatches();
  const elapsed = Date.now() - t0;

  console.log(
    `\nSweep complete in ${elapsed}ms: ` +
      `processed=${result.processedCount}, movements=${result.movementCount}`
  );

  // ── Post-sweep: verify batch state ───────────────────────────
  console.log("\n=== POST-SWEEP VERIFICATION ===\n");

  const stillPending = await ProductBatch.findAll({
    where: {
      qty: { [Op.gt]: 0 },
      expireDate: { [Op.lt]: new Date().toISOString().slice(0, 10) },
      expiredMovementCreated: false,
    },
  });

  console.log(`Expired batches still pending: ${stillPending.length}`);
  if (stillPending.length > 0) {
    for (const b of stillPending) {
      console.log(`  batch #${b.id} productId=${b.productId} qty=${b.qty} expire=${b.expireDate} flag=${b.expiredMovementCreated}`);
    }
  }

  // Show what the sweep did
  const newlyFlagged = await ProductBatch.findAll({
    where: {
      expireDate: { [Op.lt]: new Date().toISOString().slice(0, 10) },
      expiredMovementCreated: true,
      qty: 0,
    },
    order: [["id", "ASC"]],
  });
  console.log(`\nExpired batches now zeroed + flagged: ${newlyFlagged.length}`);
  for (const b of newlyFlagged) {
    console.log(`  batch #${b.id} productId=${b.productId} qty=0 expire=${b.expireDate}`);
  }

  // Show new EXPIRED movements
  const recentMovements = await StockMovement.findAll({
    where: { type: "EXPIRED" },
    order: [["createdAt", "DESC"]],
    limit: 20,
  });
  console.log(`\nRecent EXPIRED StockMovements (last 20):`);
  for (const m of recentMovements) {
    console.log(
      `  movement #${m.id} | batchId=${m.batchId} | productId=${m.productId} | ` +
        `qty=${m.quantity} | ${m.createdAt} | reason="${m.reason}"`
    );
  }

  // ── Re-check product qty drift ───────────────────────────────
  console.log("\n=== PRODUCT.QTY DRIFT CHECK (POST-SWEEP) ===\n");
  let remainingDrift = 0;
  for (const product of allProducts) {
    const batchSum = await ProductBatch.findAll({
      where: {
        productId: product.id,
        qty: { [Op.gt]: 0 },
        [Op.or]: [{ expireDate: null }, { expireDate: { [Op.gte]: new Date().toISOString().slice(0, 10) } }],
      },
      attributes: [[sequelize.fn("SUM", sequelize.col("qty")), "total"]],
      raw: true,
    });
    const liveQty = Number(batchSum[0]?.total || 0);
    if (product.qty !== liveQty) {
      remainingDrift++;
      console.log(
        `  DRIFT: product #${product.id} "${product.name}" | ` +
          `Product.qty=${product.qty} | live=${liveQty} | delta=${product.qty - liveQty}`
      );
    }
  }
  if (remainingDrift === 0) {
    console.log("  All products synced — no remaining drift.");
  }

  // ── Inventory spot-check for swept batches ───────────────────
  if (result.processedCount > 0) {
    console.log("\n=== INVENTORY SPOT-CHECK ===\n");
    for (const b of newlyFlagged) {
      const inv = await Inventory.findOne({ where: { batchId: b.id } });
      console.log(
        `  batch #${b.id}: inventory qty=${inv?.qty ?? "null"}, ` +
          `available=${inv?.availableQty ?? "null"}, reserved=${inv?.reservedQty ?? "null"}`
      );
    }
  }

  console.log("\n=== DONE ===");
  await sequelize.close();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
