const express = require("express");
const { Inventory, ProductBatch, Product, Category, sequelize } = require("../../models");
const { Op } = require("sequelize");

const router = express.Router();

// ─── GET: All Inventory records ──────────────────────────
router.get("/", async (req, res) => {
  try {
    const page   = Number(req.query.page)  || 1;
    const limit  = Number(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const productWhere = {};
    if (req.query.search) {
      const search = req.query.search.replace(/\s+/g, "").toLowerCase();
      productWhere.name = { [Op.like]: `%${search}%` };
    }
    if (req.query.categoryId) {
      productWhere.categoryId = Number(req.query.categoryId);
    }
    if (req.query.isActive !== undefined) {
      productWhere.isActive = req.query.isActive === "true";
    }
    if (req.query.inStock === "true") {
      productWhere.qty = { [Op.gt]: 0 };
    } else if (req.query.inStock === "false") {
      productWhere.qty = { [Op.lte]: 0 };
    }

    const { count, rows } = await Inventory.findAndCountAll({
      include: [
        {
          model: Product,
          as: "product",
          where: Object.keys(productWhere).length > 0 ? productWhere : undefined,
          include: [{ model: Category, as: "category", attributes: ["id", "name"] }],
        },
        {
          model: ProductBatch,
          as: "productBatch",
        },
      ],
      order: [["updatedAt", "DESC"]],
      limit,
      offset,
    });

    res.json({
      success: true,
      data: rows,
      pagination: {
        currentPage: page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (error) {
    console.error("Get inventory error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET: Inventory by Batch ID ──────────────────────────
router.get("/batch/:batchId", async (req, res) => {
  try {
    const { batchId } = req.params;

    const inv = await Inventory.findOne({
      where: { batchId },
      include: [
        {
          model: ProductBatch,
          as: "productBatch",
          include: [
            {
              model: Product,
              as: "product",
              include: [{ model: Category, as: "category", attributes: ["id", "name"] }],
            },
          ],
        },
      ],
    });

    if (!inv) {
      return res.status(404).json({ success: false, message: "Inventory not found for this batch" });
    }

    res.json({ success: true, data: inv });
  } catch (error) {
    console.error("Get inventory by batch error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET: Inventory by Product ID ────────────────────────
router.get("/product/:productId", async (req, res) => {
  try {
    const { productId } = req.params;

    const product = await Product.findByPk(productId);
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const items = await Inventory.findAll({
      include: [
        {
          model: ProductBatch,
          as: "productBatch",
          where: { productId },
          attributes: ["id", "productId", "batchNumber", "expireDate", "receivedDate", "costPrice"],
        },
      ],
      order: [["availableQty", "DESC"]],
    });

    res.json({
      success: true,
      data: items,
      total: items.length,
    });
  } catch (error) {
    console.error("Get inventory by product error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET: Low Stock Inventory ────────────────────────────
router.get("/low", async (req, res) => {
  try {
    const threshold = Number(req.query.threshold) || 10;

    const items = await Inventory.findAll({
      where: { availableQty: { [Op.lte]: threshold } },
      include: [
        {
          model: ProductBatch,
          as: "productBatch",
          include: [
            {
              model: Product,
              as: "product",
              include: [{ model: Category, as: "category", attributes: ["id", "name"] }],
            },
          ],
        },
      ],
      order: [["availableQty", "ASC"]],
    });

    res.json({
      success: true,
      data: items,
      total: items.length,
      threshold,
    });
  } catch (error) {
    console.error("Get low stock inventory error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

module.exports = router;
