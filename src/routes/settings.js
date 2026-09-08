const express = require("express");
const { Setting } = require("../../models");
const { authenticate, authorizeRoles } = require("../middlewares/authMiddleware");
const requireRole = require("../middlewares/requireRole");

const router = express.Router();

// ─── GET /api/v1/settings/exchange-rate ───────────────────
// Public, no auth — same source of truth as the ABA PayWay conversion
// in src/routes/payment.js, so display rate and charged rate cannot drift.
router.get("/exchange-rate", (req, res) => {
  const usdToKhr = Number(process.env.ABA_PAYWAY_KHR_RATE) || 4100;
  return res.json({ usd_to_khr: usdToKhr });
});

// ─── GET /api/v1/settings/monthly-target ──────────────────
// Authenticated — returns the monthly sales target.
// Defaults to 5000 when no record exists yet (first load).
router.get("/monthly-target", authenticate, async (req, res) => {
  try {
    const record = await Setting.findOne({
      where: { key: "monthly_target" },
    });

    const value = record ? Number(record.value) : 5000;

    return res.json({ value });
  } catch (error) {
    console.error("Get monthly target error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// ─── PUT /api/v1/settings/monthly-target ──────────────────
// Admin only — creates or updates the monthly sales target.
// Body: { value: number } — must be > 0.
router.put(
  "/monthly-target",
  authenticate,
  authorizeRoles("admin"),
  async (req, res) => {
    try {
      const rawValue = req.body?.value;

      if (rawValue === undefined || rawValue === null || rawValue === "") {
        return res.status(400).json({ message: "value is required" });
      }

      const value = Number(rawValue);

      if (!Number.isFinite(value) || value <= 0) {
        return res.status(400).json({ message: "value must be a number greater than 0" });
      }

      // Upsert: find existing record or create it, then update the value.
      const [setting] = await Setting.findOrCreate({
        where: { key: "monthly_target" },
        defaults: { value },
      });

      if (!setting.isNewRecord) {
        await setting.update({ value });
      }

      return res.json({ value: Number(setting.value) });
    } catch (error) {
      console.error("Update monthly target error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

module.exports = router;
