const express = require("express");
const { StockMovement, Product, ProductBatch, User, Category, sequelize } = require("../../models");
const { Op } = require("sequelize");

const router = express.Router();

// ─── GET: All Stock Movements ────────────────────────────
router.get("/", async (req, res) => {
  try {
    const page    = Number(req.query.page)    || 1;
    const limit   = Number(req.query.limit)   || 20;
    const offset  = (page - 1) * limit;
    const type    = req.query.type;
    const productId = req.query.productId;
    const batchId   = req.query.batchId;

    const where = {};
    if (type)       where.type       = type;
    if (productId)  where.productId  = Number(productId);
    if (batchId)    where.batchId    = Number(batchId);

    const { count, rows } = await StockMovement.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "firstName", "lastName", "email", "role"],
        },
        {
          model: Product,
          as: "product",
          attributes: ["id", "name", "sku"],
        },
        {
          model: ProductBatch,
          as: "productBatch",
          attributes: ["id", "batchNumber", "expireDate"],
        },
      ],
      order: [["createdAt", "DESC"]],
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
    console.error("Get stock movements error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET: Single Stock Movement ──────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const movement = await StockMovement.findByPk(req.params.id, {
      include: [
        { model: User, as: "user", attributes: ["id", "firstName", "lastName", "email", "role"] },
        { model: Product, as: "product", attributes: ["id", "name", "sku"] },
        { model: ProductBatch, as: "productBatch", attributes: ["id", "batchNumber", "expireDate"] },
      ],
    });

    if (!movement) {
      return res.status(404).json({ success: false, message: "Stock movement not found" });
    }

    res.json({ success: true, data: movement });
  } catch (error) {
    console.error("Get stock movement error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET: Movements by Product ───────────────────────────
router.get("/product/:productId", async (req, res) => {
  try {
    const { productId } = req.params;
    const page   = Number(req.query.page)  || 1;
    const limit  = Number(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const product = await Product.findByPk(productId);
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const { count, rows } = await StockMovement.findAndCountAll({
      where: { productId },
      include: [
        { model: User, as: "user", attributes: ["id", "firstName", "lastName", "email", "role"] },
        { model: ProductBatch, as: "productBatch", attributes: ["id", "batchNumber", "expireDate"] },
      ],
      order: [["createdAt", "DESC"]],
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
    console.error("Get product movements error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET: Movements by Batch ─────────────────────────────
router.get("/batch/:batchId", async (req, res) => {
  try {
    const { batchId } = req.params;
    const page   = Number(req.query.page)  || 1;
    const limit  = Number(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const batch = await ProductBatch.findByPk(batchId);
    if (!batch) {
      return res.status(404).json({ success: false, message: "Batch not found" });
    }

    const { count, rows } = await StockMovement.findAndCountAll({
      where: { batchId },
      include: [
        { model: User, as: "user", attributes: ["id", "firstName", "lastName", "email", "role"] },
        { model: Product, as: "product", attributes: ["id", "name", "sku"] },
      ],
      order: [["createdAt", "DESC"]],
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
    console.error("Get batch movements error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET: Movements by Type ──────────────────────────────
router.get("/type/:type", async (req, res) => {
  try {
    const { type } = req.params;
    const validTypes = ["PURCHASE", "SALE", "RETURN", "ADJUSTMENT", "DAMAGE", "EXPIRED"];

    if (!validTypes.includes(type.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: `Invalid type. Must be one of: ${validTypes.join(", ")}`,
      });
    }

    const page   = Number(req.query.page)  || 1;
    const limit  = Number(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const { count, rows } = await StockMovement.findAndCountAll({
      where: { type: type.toUpperCase() },
      include: [
        { model: User, as: "user", attributes: ["id", "firstName", "lastName", "email", "role"] },
        { model: Product, as: "product", attributes: ["id", "name", "sku"] },
        { model: ProductBatch, as: "productBatch", attributes: ["id", "batchNumber", "expireDate"] },
      ],
      order: [["createdAt", "DESC"]],
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
    console.error("Get movements by type error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

module.exports = router;
