const express = require("express");
const fs = require("fs");
const path = require("path");
const { Product, ProductImage, ProductBatch, Category } = require("../../models");
const { Op, fn, col, where } = require("sequelize");
const generateBarcodePDF = require('../utils/generateBarcodePDF');
const { addStockToBatch, deductStockFifo, syncProductFromBatches } = require('../utils/batchStock');
const { authenticate, authorizeRoles } = require("../middlewares/authMiddleware");
const router = express.Router();
const { storage, cloudinary } = require('../storage/storage')
const multer = require('multer');
const upload = multer({ storage });


// ─── GET: All Products ────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const page   = Number(req.query.page)  || 1;
    const limit  = Number(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const conditions = [];

    if (req.query.search) {
      const search = req.query.search.replace(/\s+/g, "").toLowerCase();
      conditions.push({
        [Op.or]: [
          where(
            fn("REPLACE", fn("LOWER", col("Product.name")), " ", ""),
            { [Op.like]: `%${search}%` }
          ),
          { barcode: { [Op.like]: `%${search}%` } },
          { sku: { [Op.like]: `%${search}%` } },
        ],
      });
    }

    if (req.query.categoryId) {
      conditions.push({ categoryId: req.query.categoryId });
    }

    if (req.query.inStock === "false") {
      conditions.push({ qty: { [Op.lte]: 0 } });
    } else if (req.query.maxQty !== undefined) {
      conditions.push({ qty: { [Op.lte]: Number(req.query.maxQty) } });
    }

    const whereCondition = conditions.length > 0
      ? { [Op.and]: conditions }
      : {};

    const { rows: products, count: total } = await Product.findAndCountAll({
      where: whereCondition,
      distinct: true,
      limit,
      offset,
      order: [["createdAt", "DESC"]],
      include: [
        {
          model: Category,
          as: "category",
          attributes: ["id", "name"],
        },
        {
          model: ProductImage,
          as: "productImages",
          attributes: ["id", "productId", "imageUrl", "fileName", "publicId"],
        },
      ],
    });

    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      message: "Products fetched successfully",
      data: products,
      pagination: {
        currentPage: page,
        limit,
        total,
        totalPages,
        nextPage: page < totalPages ? page + 1 : null,
        prevPage: page > 1 ? page - 1 : null,
      },
    });
  } catch (error) {
    console.error("Get products error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET: Low Stock ───────────────────────────────────────
router.get("/stock/low", async (req, res) => {
  try {
    const threshold = Number(req.query.threshold) || 10;

    const products = await Product.findAll({
      where: { qty: { [Op.lte]: threshold } },
      order: [["qty", "ASC"]],
      include: [
        { model: Category, as: "category", attributes: ["id", "name"] },
        {
          model: ProductImage,
          as: "productImages",
          attributes: ["id", "imageUrl"],
        },
      ],
    });

    res.json({
      success: true,
      message: "Low stock products fetched successfully",
      data: products,
      total: products.length,
      threshold,
    });
  } catch (error) {
    console.error("Low stock error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET: Near Expiry Products ───────────────────────────
// Returns individual ProductBatch rows whose expire_date is within `days`
// from today (default 20), sorted by expire_date ascending, joined with the
// product (name/sku/price/discount). Includes already-discounted products too.
router.get("/near-expiry", async (req, res) => {
  try {
    const days = Math.max(1, Number(req.query.days) || 20);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + days);
    horizon.setHours(23, 59, 59, 999);

    const batches = await ProductBatch.findAll({
      where: {
        qty: { [Op.gt]: 0 },
        expireDate: { [Op.ne]: null },
        [Op.and]: [
          { expireDate: { [Op.gte]: today } },
          { expireDate: { [Op.lte]: horizon } },
        ],
      },
      order: [["expireDate", "ASC"], ["createdAt", "ASC"]],
      include: [
        {
          model: Product,
          as: "product",
          attributes: [
            "id", "name", "sku", "price", "qty",
            "discountPercent",
          ],
          include: [
            { model: Category, as: "category", attributes: ["id", "name"] },
            {
              model: ProductImage,
              as: "productImages",
              attributes: ["id", "productId", "imageUrl", "fileName", "publicId"],
            },
          ],
        },
      ],
    });

    res.json({
      success: true,
      message: "Near-expiry batches fetched successfully",
      data: batches,
      total: batches.length,
      days,
    });
  } catch (error) {
    console.error("Near-expiry error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET: Lookup product by barcode — fast O(1) DB lookup ────
router.get("/barcode/:code", async (req, res) => {
  try {
    const { code } = req.params;
    const product = await Product.findOne({
      where: { barcode: code },
      include: [
        { model: Category, as: "category", attributes: ["id", "name"] },
        {
          model: ProductImage,
          as: "productImages",
          attributes: ["id", "productId", "imageUrl", "fileName", "publicId"],
        },
      ],
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: `Product with barcode "${code}" not found`,
      });
    }

    res.json({
      success: true,
      message: "Product found by barcode",
      data: product,
    });
  } catch (error) {
    console.error("Barcode lookup error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET: All Barcodes PDF ────────────────────────────────
router.get('/barcodes/print', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const products = await Product.findAll({
      where: { isActive: true },
      attributes: ['id', 'name', 'price'],
    });

    if (!products.length) {
      return res.status(404).json({ success: false, message: 'No products found' });
    }

    const pdf = await generateBarcodePDF(products);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=product-labels.pdf');
    res.send(pdf);
  } catch (error) {
    console.error('Barcode PDF error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── POST: Selected Barcodes PDF ─────────────────────────
// Body: { ids: number[] }  — print only the chosen product IDs
router.post('/barcodes/print', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'ids must be a non-empty array of product IDs',
      });
    }

    const sanitizedIds = [...new Set(
      ids.filter((id) => Number.isInteger(Number(id))).map((id) => Number(id))
    )];

    if (sanitizedIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'ids must be a non-empty array of product IDs',
      });
    }

    const products = await Product.findAll({
      where: { id: sanitizedIds, isActive: true },
      attributes: ['id', 'name', 'price'],
    });

    if (!products.length) {
      return res.status(404).json({
        success: false,
        message: 'No products found for the given ids',
      });
    }

    const pdf = await generateBarcodePDF(products);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=labels-selected.pdf');
    res.send(pdf);
  } catch (error) {
    console.error('Barcode PDF error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── POST: Add Product Batch (admin/cashier) ─────────────
// Body: { qty, expire_date?, batch_number?, cost_price? }
// Adds received stock as a new batch instead of just bumping Product.qty.
router.post("/:id/batches", async (req, res) => {
  try {
    const { id } = req.params;
    const { qty, expire_date, batch_number, cost_price } = req.body;

    const product = await Product.findByPk(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: `Product id=${id} not found`,
      });
    }

    if (!qty || isNaN(qty) || Number(qty) <= 0) {
      return res.status(400).json({
        success: false,
        message: "qty must be a positive number",
      });
    }

    const batch = await addStockToBatch(
      id,
      {
        qty: Number(qty),
        expireDate: expire_date || null,
        batchNumber: batch_number || null,
        costPrice: cost_price,
      }
    );

    res.status(201).json({
      success: true,
      message: "Batch added successfully",
      data: batch,
    });
  } catch (error) {
    console.error("Add batch error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET: List Product Batches ───────────────────────────
// Ordered by expire_date ASC (soonest-expiring first), no-expiry last.
router.get("/:id/batches", async (req, res) => {
  try {
    const { id } = req.params;

    const product = await Product.findByPk(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: `Product id=${id} not found`,
      });
    }

    const batches = await ProductBatch.findAll({
      where: { productId: id },
      order: [["expireDate", "ASC NULLS LAST"], ["createdAt", "ASC"]],
    });

    res.json({
      success: true,
      message: "Product batches fetched successfully",
      data: batches,
      total: batches.length,
    });
  } catch (error) {
    console.error("Get batches error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── DELETE: Remove a Product Batch (admin only) ─────────
router.delete("/batches/:batchId", authenticate, authorizeRoles("admin"), async (req, res) => {
  try {
    const { batchId } = req.params;

    const batch = await ProductBatch.findByPk(batchId);
    if (!batch) {
      return res.status(404).json({
        success: false,
        message: `Batch id=${batchId} not found`,
      });
    }

    const productId = batch.productId;
    await batch.destroy();
    await syncProductFromBatches(productId);

    res.json({
      success: true,
      message: "Batch deleted successfully",
    });
  } catch (error) {
    console.error("Delete batch error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET: Stock Info ──────────────────────────────────────
router.get("/:id/stock", async (req, res) => {
  try {
    const { id } = req.params;
    const product = await Product.findByPk(id, {
      attributes: ["id", "name", "qty"],
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: `Product id=${id} not found`,
      });
    }

    const qty = product.qty;
    const stockStatus =
      qty === 0  ? "OUT_OF_STOCK" :
      qty <= 10  ? "LOW_STOCK"    : "IN_STOCK";

    res.json({
      success: true,
      message: "Stock fetched successfully",
      data: { productId: product.id, name: product.name, qty, stockStatus },
    });
  } catch (error) {
    console.error("Get stock error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET: Single Barcode PDF ──────────────────────────────
router.get('/:id/barcode/print', async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id, {
      attributes: ['id', 'name', 'price'],
    });

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const pdf = await generateBarcodePDF([product]);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=label-${product.id}.pdf`);
    res.send(pdf);
  } catch (error) {
    console.error('Barcode PDF error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── POST: Create Product (admin only) ───────────────────
router.post("/", authenticate, authorizeRoles("admin"), async (req, res) => {
  try {
    const { name, price, categoryId, isActive, qty, barcode, sku, expireDate, expire_date } = req.body;

    if (!name || !price || !categoryId) {
      return res.status(400).json({
        success: false,
        message: "name, price, categoryId are required",
      });
    }

    const createdProduct = await Product.create({
      name,
      price,
      categoryId,
      qty: qty || 0,
      isActive: isActive ?? true,
      barcode: barcode || null,
      sku: sku || null,
      expireDate: expireDate ?? expire_date ?? null,
    });

    // Keep the batch table as source of truth: seed an initial batch for any
    // starting stock so Products.qty = SUM(ProductBatches.qty) always holds.
    if (Number(qty) > 0) {
      await addStockToBatch(
        createdProduct.id,
        {
          qty: Number(qty),
          expireDate: expireDate ?? expire_date ?? null,
        }
      );
    }

    res.status(201).json({
      success: true,
      message: "Product created successfully",
      data: createdProduct,
    });
  } catch (error) {
    console.error("Create product error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── POST: Upload Product Image (admin only) ──────────────
router.post("/:id/upload", authenticate, authorizeRoles("admin"), upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    const { id } = req.params;

    if (!file) {
      return res.status(400).json({
        success: false,
        message: "No file provided",
      });
    }

    const product = await Product.findByPk(id);
    if (!product) {
      const orphanId = file.filename;
      if (orphanId) {
        await cloudinary.uploader.destroy(orphanId).catch(() => {});
      }
      return res.status(404).json({
        success: false,
        message: `Product id=${id} not found`,
      });
    }

    const existingImages = await ProductImage.findAll({ where: { productId: id } });

    if (existingImages.length > 0) {
      await Promise.all(
        existingImages
          .filter(img => img.publicId)
          .map(img =>
            cloudinary.uploader.destroy(img.publicId).catch((err) => {
              console.warn(`Could not delete Cloudinary image ${img.publicId}:`, err.message);
            })
          )
      );
      await ProductImage.destroy({ where: { productId: id } });
    }

    const productImage = await ProductImage.create({
      productId: id,
      imageUrl:  file.path,
      fileName:  file.originalname,
      publicId:  file.filename,
    });

    res.status(201).json({
      success: true,
      message: "Image uploaded successfully",
      data: productImage,
    });
  } catch (error) {
    console.error("Upload image error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── DELETE: Product Image (admin only) ──────────────────
router.delete("/:productId/images/:imageId", authenticate, authorizeRoles("admin"), async (req, res) => {
  try {
    const { imageId } = req.params;

    const image = await ProductImage.findByPk(imageId);
    if (!image) {
      return res.status(404).json({
        success: false,
        message: `Image id=${imageId} not found`,
      });
    }

    if (image.publicId) {
      await cloudinary.uploader.destroy(image.publicId);
    }

    await image.destroy();

    res.json({
      success: true,
      message: "Image deleted successfully",
    });
  } catch (error) {
    console.error("Delete image error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── DELETE: Product (admin only) ────────────────────────
router.delete("/:id", authenticate, authorizeRoles("admin"), async (req, res) => {
  try {
    const { id } = req.params;
    const product = await Product.findByPk(id, {
      include: [{ model: ProductImage, as: "productImages" }],
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: `Product id=${id} not found`,
      });
    }

    if (product.productImages?.length > 0) {
      await Promise.all(
        product.productImages
          .filter(img => img.publicId)
          .map(img => cloudinary.uploader.destroy(img.publicId))
      );
    }

    await product.destroy();

    res.json({
      success: true,
      message: "Product deleted successfully",
      data: product,
    });
  } catch (error) {
    console.error("Delete product error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── PUT: Update Product (admin only) ────────────────────
router.put("/:id", authenticate, authorizeRoles("admin"), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, price, categoryId, isActive, qty, barcode, sku, expireDate, expire_date } = req.body;

    const product = await Product.findByPk(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: `Product id=${id} not found`,
      });
    }

    // Normalize empty expire_date to null so clearing the field works
    const nextExpireDate = expireDate ?? expire_date ?? null;
    // True when the caller explicitly sent the expire-date field (even null),
    // so we can tell "user cleared the date" from "field not included at all".
    const expireFieldProvided =
      Object.prototype.hasOwnProperty.call(req.body, "expireDate") ||
      Object.prototype.hasOwnProperty.call(req.body, "expire_date");

    await product.update({
      name,
      price,
      categoryId,
      qty,
      isActive,
      barcode: barcode || null,
      sku: sku || null,
      expireDate: nextExpireDate,
    });

    // Reconcile the denormalized Product.qty field against the batch table.
    // Batches are the source of truth; if the form's qty differs from the sum
    // of batch quantities, add or deduct the difference so the invariant holds.
    const requestedQty = Number(qty) || 0;
    const batches = await ProductBatch.findAll({ where: { productId: id } });
    const sumQty = batches.reduce((s, b) => s + Number(b.qty), 0);
    const delta = requestedQty - sumQty;

    if (delta > 0) {
      await addStockToBatch(id, { qty: delta, expireDate: nextExpireDate });
      // A form-set expireDate must win over any older batch expiry, so stamp
      // every qty>0 batch with it; otherwise the sync below prefers the
      // soonest existing batch and the saved value would be clobbered.
      if (expireFieldProvided && nextExpireDate) {
        await ProductBatch.update(
          { expireDate: nextExpireDate },
          { where: { productId: id, qty: { [Op.gt]: 0 } } }
        );
      }
      await syncProductFromBatches(id);
    } else if (delta < 0) {
      await deductStockFifo(id, Math.abs(delta));
      // Same batch reconciliation as the other branches so a form-set or
      // form-cleared expireDate survives even when stock was deducted.
      if (expireFieldProvided) {
        await ProductBatch.update(
          { expireDate: nextExpireDate },
          { where: { productId: id, qty: { [Op.gt]: 0 } } }
        );
        await syncProductFromBatches(id);
      }
    } else {
      // qty already matches — reconcile the batch that drives the expire_date
      // cache so the form value (set or cleared) survives the sync below
      // instead of being clobbered by syncProductFromBatches.
      if (expireFieldProvided) {
        await ProductBatch.update(
          { expireDate: nextExpireDate },
          { where: { productId: id, qty: { [Op.gt]: 0 } } }
        );
      }
      // Refresh expire_date cache from batches (sooner batch wins).
      await syncProductFromBatches(id);
    }

    const updatedProduct = await Product.findByPk(id, {
      include: [{ model: Category, as: "category" }],
    });

    res.json({
      success: true,
      message: "Product updated successfully",
      data: updatedProduct,
    });
  } catch (error) {
    console.error("Update product error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── PATCH: Stock In (admin only) ────────────────────────
router.patch("/:id/stock/in", authenticate, authorizeRoles("admin"), async (req, res) => {
  try {
    const { id } = req.params;
    const { qty } = req.body;

    if (!qty || isNaN(qty) || Number(qty) <= 0) {
      return res.status(400).json({
        success: false,
        message: "qty must be a positive number",
      });
    }

    const product = await Product.findByPk(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: `Product id=${id} not found`,
      });
    }

    const oldQty = product.qty;

    // Add as a new batch (no expiry) — batches are the source of truth.
    await addStockToBatch(id, { qty: Number(qty) });

    const updated = await Product.findByPk(id);
    const newQty = updated.qty;

    res.json({
      success: true,
      message: `Stock added successfully (+${qty})`,
      data: {
        productId:   product.id,
        name:        product.name,
        previousQty: oldQty,
        addedQty:    Number(qty),
        currentQty:  newQty,
      },
    });
  } catch (error) {
    console.error("Stock in error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── PATCH: Stock Out (admin only) ───────────────────────
router.patch("/:id/stock/out", authenticate, authorizeRoles("admin"), async (req, res) => {
  try {
    const { id } = req.params;
    const { qty } = req.body;

    if (!qty || isNaN(qty) || Number(qty) <= 0) {
      return res.status(400).json({
        success: false,
        message: "qty must be a positive number",
      });
    }

    const product = await Product.findByPk(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: `Product id=${id} not found`,
      });
    }

    if (Number(qty) > product.qty) {
      return res.status(400).json({
        success: false,
        message: `Insufficient stock. Available: ${product.qty}, Requested: ${qty}`,
      });
    }

    const oldQty = product.qty;

    // Deduct FIFO (soonest-expiring batch first) — batches are the source of truth.
    await deductStockFifo(id, Number(qty));

    const updated = await Product.findByPk(id);
    const newQty = updated.qty;

    res.json({
      success: true,
      message: `Stock removed successfully (-${qty})`,
      data: {
        productId:   product.id,
        name:        product.name,
        previousQty: oldQty,
        removedQty:  Number(qty),
        currentQty:  newQty,
      },
    });
  } catch (error) {
    console.error("Stock out error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── PATCH: Set Product Discount (admin only) ────────────
// Body: { discount_percent: 0–100 }
// Passing discount_percent = 0 (or omitting it) clears the discount.
router.patch("/:id/discount", authenticate, authorizeRoles("admin"), async (req, res) => {
  try {
    const { id } = req.params;
    const { discount_percent } = req.body;

    const product = await Product.findByPk(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: `Product id=${id} not found`,
      });
    }

    let percent = 0;
    if (discount_percent !== undefined && discount_percent !== null && discount_percent !== "") {
      percent = Number(discount_percent);
      if (isNaN(percent) || percent < 0 || percent > 100) {
        return res.status(400).json({
          success: false,
          message: "discount_percent must be a number between 0 and 100",
        });
      }
      // Discounts outside 10–90% are rejected (0 still means "clear discount")
      if (percent !== 0 && (percent < 10 || percent > 90)) {
        return res.status(400).json({
          success: false,
          message: "Discount must be between 10% and 90%",
        });
      }
    }

    await product.update({
      discountPercent: percent,
    });

    const updatedProduct = await Product.findByPk(id, {
      include: [{ model: Category, as: "category" }],
    });

    res.json({
      success: true,
      message: percent > 0
        ? `Discount set to ${percent}%`
        : "Discount removed",
      data: updatedProduct,
    });
  } catch (error) {
    console.error("Set discount error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

module.exports = router;