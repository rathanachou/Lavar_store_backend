const express = require("express");
const { ProductBatch, Product, Category, Inventory } = require("../../models");

const router = express.Router();

// ─── GET: Single Product Batch by ID ──────────────────────
// Returns batch with product, category, and inventory info.
router.get("/:batchId", async (req, res) => {
  try {
    const { batchId } = req.params;

    const batch = await ProductBatch.findByPk(batchId, {
      include: [
        {
          model: Product,
          as: "product",
          include: [{ model: Category, as: "category", attributes: ["id", "name"] }],
        },
        {
          model: Inventory,
          as: "inventory",
          required: false,
        },
      ],
    });

    if (!batch) {
      return res.status(404).json({ success: false, message: `Batch id=${batchId} not found` });
    }

    res.json({ success: true, data: batch });
  } catch (error) {
    console.error("Get batch error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

module.exports = router;
