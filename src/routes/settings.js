const express = require("express");

const router = express.Router();

// ─── GET /api/v1/settings/exchange-rate ────────────────
// Public, no auth — same source of truth as the ABA PayWay conversion
// in src/routes/payment.js, so display rate and charged rate cannot drift.
router.get("/exchange-rate", (req, res) => {
  const usdToKhr = Number(process.env.ABA_PAYWAY_KHR_RATE) || 4100;
  return res.json({ usd_to_khr: usdToKhr });
});

module.exports = router;
