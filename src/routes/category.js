'use strict';
const express  = require("express");
const { Category, Product } = require("../../models");
const { Op }   = require("sequelize");
const { authenticate, authorizeRoles } = require("../middlewares/authMiddleware");

const router = express.Router();

// GET: All Categories
router.get("/", authenticate, async (req, res) => {
  try {
    const where = req.query.search
      ? { name: { [Op.like]: `%${req.query.search}%` } }
      : {};

    const categories = await Category.findAll({
      where,
      include: [{ model: Product, as: "products" }],
    });

    res.json({ message: "Category fetched successfully", data: categories });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET: List only
router.get("/list", authenticate, async (req, res) => {
  try {
    const categories = await Category.findAll();
    res.json({ message: "Category fetched successfully", data: categories });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST: Create
router.post("/", authenticate, authorizeRoles("admin"), async (req, res) => {
  try {
    const { name, isActive } = req.body;
    const created = await Category.create({ name, isActive });
    res.status(201).json({ message: "Category created successfully", data: created });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PUT: Update
router.put("/:id", authenticate, authorizeRoles("admin"), async (req, res) => {
  try {
    const { id }   = req.params;
    const { name } = req.body;

    const category = await Category.findByPk(id);
    if (!category) {
      return res.status(404).json({ message: `Category id=${id} not found` });
    }

    const updated = await category.update({ name });
    res.json({ message: "Category updated successfully", data: updated });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// DELETE
router.delete("/:id", authenticate, authorizeRoles("admin"), async (req, res) => {
  try {
    const { id } = req.params;

    const category = await Category.findByPk(id);
    if (!category) {
      return res.status(404).json({ message: `Category id=${id} not found` });
    }

    await category.destroy();
    res.json({ message: "Category deleted successfully", data: category });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;