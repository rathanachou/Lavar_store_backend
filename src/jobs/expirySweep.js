/**
 * Automated expiry sweep job.
 *
 * Finds ProductBatch rows whose expire_date has passed (strictly before
 * today), qty > 0, and that have not yet been processed (expired_movement_created = false).
 * For each such batch it:
 *   1. Records the original qty
 *   2. Sets ProductBatch.qty = 0 and expired_movement_created = true
 *   3. Updates Inventory (delta = -originalQty)
 *   4. Creates an EXPIRED StockMovement (quantity = -originalQty)
 *   5. Re-syncs Product.qty and Product.expireDate
 *
 * All steps run inside a single transaction per batch so the database
 * never sees a half-written state.
 *
 * The job runs once on server startup (to catch anything that expired
 * while the server was down) and then once per day at midnight via
 * node-cron.
 */
const cron = require("node-cron");
const { sequelize } = require("../../models");
const { processExpiredBatches } = require("../utils/batchStock");

let task = null;

/**
 * Start the expiry sweep scheduler. Call once after the database
 * connection is confirmed.
 */
function startExpirySweep() {
  // Run once immediately on startup
  runSweep("startup").catch((err) => {
    console.error("[ExpirySweep] Startup run failed:", err);
  });

  // Then schedule daily at midnight
  task = cron.schedule("0 0 * * *", () => {
    runSweep("scheduled").catch((err) => {
      console.error("[ExpirySweep] Scheduled run failed:", err);
    });
  });

  console.log("[ExpirySweep] Scheduler started — daily at midnight");
}

/**
 * Execute the expiry sweep and log a summary.
 *
 * @param {string} source — "startup" | "scheduled"
 */
async function runSweep(source) {
  console.log(`[ExpirySweep] Starting sweep (source=${source})...`);
  const t0 = Date.now();

  try {
    const result = await processExpiredBatches();
    const elapsed = Date.now() - t0;

    if (result.processedCount > 0) {
      console.log(
        `[ExpirySweep] Done — processed ${result.processedCount} batch(es), ` +
          `${result.movementCount} movement(s) created (${elapsed}ms)`
      );
    } else {
      console.log(`[ExpirySweep] Done — no expired batches found (${elapsed}ms)`);
    }

    return result;
  } catch (err) {
    console.error(`[ExpirySweep] Sweep error (source=${source}):`, err);
    throw err;
  }
}

/**
 * Stop the scheduler (useful for tests or graceful shutdown).
 */
function stopExpirySweep() {
  if (task) {
    task.stop();
    task = null;
    console.log("[ExpirySweep] Scheduler stopped");
  }
}

module.exports = {
  startExpirySweep,
  stopExpirySweep,
  runSweep,
};
