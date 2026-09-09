const express = require("express");
const fs = require("fs");
const path = require("path");
const { Product, ProductImage, ProductBatch, Category, sequelize } = require("../../models");
const { Op, fn, col, where } = require("sequelize");
const generateBarcodePDF = require('../utils/generateBarcodePDF');
const { addStockToBatch, deductStockFifo, syncProductFromBatches, createStockMovement, updateInventoryForBatch, ensureInventoryForBatch, isExpired } = require('../utils/batchStock');
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

    if (req.query.inStock === "true") {
      conditions.push({ qty: { [Op.gt]: 0 } });
    } else if (req.query.inStock === "false") {
      conditions.push({ qty: { [Op.lte]: 0 } });
    } else if (req.query.maxQty !== undefined) {
      conditions.push({ qty: { [Op.lte]: Number(req.query.maxQty) } });
    }

    if (req.query.isActive !== undefined) {
      conditions.push({ isActive: req.query.isActive === "true" });
    }

    const whereCondition = conditions.length > 0
      ? { [Op.and]: conditions }
      : {};

    // Sort by nearest batch expiry (soonest first, no-expiry last) when
    // ?sort=expiry is requested. Otherwise default to createdAt DESC.
    const sortExpiry = req.query.sort === "expiry";
    const orderClause = sortExpiry
      ? [
          sequelize.literal(
            '(SELECT MIN("expireDate") FROM "ProductBatches" WHERE "ProductBatches"."productId" = "Product"."id") ASC NULLS LAST'
          ),
        ]
      : [["createdAt", "DESC"]];

    const { rows: products, count: total } = await Product.findAndCountAll({
      where: whereCondition,
      distinct: true,
      limit,
      offset,
      order: orderClause,
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
router.get("/stock/low", authenticate, async (req, res) => {
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
router.get("/near-expiry", authenticate, async (req, res) => {
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
router.get("/barcode/:code", authenticate, async (req, res) => {
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

    const qty = Number(product.qty) || 0;
    const expired = await isExpired(product.id);

    res.json({
      success: true,
      message: "Product found by barcode",
      data: {
        ...product.toJSON(),
        isExpired:     expired,
        isOutOfStock:  qty <= 0,
        isInactive:    !product.isActive,
      },
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

// ─── POST: Add Product Batch (admin only) ─────────────────
// Body: { qty, expire_date?, batch_number?, cost_price? }
// Adds received stock as a new batch instead of just bumping Product.qty.
// Also creates Inventory row and PURCHASE stock movement.
router.post("/:id/batches", authenticate, authorizeRoles("admin"), async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { id } = req.params;
    // Accept both snake_case (legacy) and camelCase (frontend) field names.
    const { qty, expire_date, batch_number, cost_price, expireDate, batchNumber, costPrice } = req.body;
    const _expireDate = expireDate ?? expire_date ?? null;
    const _batchNumber = batchNumber ?? batch_number ?? null;
    const _costPrice = costPrice ?? cost_price ?? null;

    const product = await Product.findByPk(id, { transaction });
    if (!product) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: `Product id=${id} not found`,
      });
    }

    if (!qty || isNaN(qty) || Number(qty) <= 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "qty must be a positive number",
      });
    }

    const batch = await addStockToBatch(
      id,
      {
        qty: Number(qty),
        expireDate: _expireDate,
        batchNumber: _batchNumber,
        costPrice: _costPrice,
      },
      { transaction }
    );

    // Create Inventory record and PURCHASE movement
    await ensureInventoryForBatch(batch.id, id, { transaction });
    await updateInventoryForBatch(batch.id, Number(qty), 0, id, { transaction });
    await createStockMovement(
      id,
      batch.id,
      "PURCHASE",
      Number(qty),
      {
        userId: req.user ? req.user.id : null,
        referenceId: `batch:${batch.id}`,
        reason:      "Stock received",
        transaction,
      }
    );

    await transaction.commit();

    res.status(201).json({
      success: true,
      message: "Batch added successfully",
      data: batch,
    });
  } catch (error) {
    await transaction.rollback();
    console.error("Add batch error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET: List Product Batches ───────────────────────────
// Ordered by expire_date ASC (soonest-expiring first), no-expiry last.
router.get("/:id/batches", authenticate, async (req, res) => {
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
// Creates an ADJUSTMENT movement recording the deleted qty before removal.
router.delete("/batches/:batchId", authenticate, authorizeRoles("admin"), async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { batchId } = req.params;

    const batch = await ProductBatch.findByPk(batchId, { transaction });
    if (!batch) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: `Batch id=${batchId} not found`,
      });
    }

    const productId = batch.productId;
    const deletedQty = Number(batch.qty);

    // Record the adjustment before destroying the batch
    await createStockMovement(
      productId,
      batch.id,
      "ADJUSTMENT",
      -deletedQty,
      {
        userId: req.user ? req.user.id : null,
        referenceId: `batch:${batch.id}`,
        reason:      "Batch deleted",
        transaction,
      }
    );

    // Remove inventory record if it exists
    const inv = await Inventory.findOne({ where: { batchId: batch.id }, transaction });
    if (inv) await inv.destroy({ transaction });

    await batch.destroy({ transaction });
    await syncProductFromBatches(productId, { transaction });

    await transaction.commit();

    res.json({
      success: true,
      message: "Batch deleted successfully",
    });
  } catch (error) {
    await transaction.rollback();
    console.error("Delete batch error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET: Stock Info ──────────────────────────────────────
router.get("/:id/stock", authenticate, async (req, res) => {
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
router.get('/:id/barcode/print', authenticate, authorizeRoles('admin'), async (req, res) => {
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
  const transaction = await sequelize.transaction();
  try {
    const { name, price, categoryId, isActive, qty, barcode, sku, expireDate, expire_date } = req.body;

    if (!name || !price || !categoryId) {
      await transaction.rollback();
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
    }, { transaction });

    // Keep the batch table as source of truth: seed an initial batch for any
    // starting stock so Products.qty = SUM(ProductBatches.qty) always holds.
    if (Number(qty) > 0) {
      const batch = await addStockToBatch(
        createdProduct.id,
        {
          qty: Number(qty),
          expireDate: expireDate ?? expire_date ?? null,
        },
        { transaction }
      );

      // Initialize Inventory and create PURCHASE movement
      await ensureInventoryForBatch(batch.id, createdProduct.id, { transaction });
      await updateInventoryForBatch(batch.id, Number(qty), 0, createdProduct.id, { transaction });
      await createStockMovement(
        createdProduct.id,
        batch.id,
        "PURCHASE",
        Number(qty),
        {
          userId: req.user ? req.user.id : null,
          referenceId: `product:${createdProduct.id}`,
          reason:      "Initial stock on product creation",
          transaction,
        }
      );
    }

    await transaction.commit();

    res.status(201).json({
      success: true,
      message: "Product created successfully",
      data: createdProduct,
    });
  } catch (error) {
    await transaction.rollback();
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
  const transaction = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { name, price, categoryId, isActive, qty, barcode, sku, expireDate, expire_date } = req.body;

    const product = await Product.findByPk(id, { transaction });
    if (!product) {
      await transaction.rollback();
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
    }, { transaction });

    // Reconcile the denormalized Product.qty field against the batch table
    // ONLY when the caller explicitly sent a qty value. If qty is absent from
    // the request body (e.g. admin is editing name/price only), we must NOT
    // touch batch stock — Number(undefined) would become 0 and zero every batch.
    const qtyFieldProvided = Object.prototype.hasOwnProperty.call(req.body, "qty");

    if (qtyFieldProvided) {
      const requestedQty = Number(qty) || 0;
      const batches = await ProductBatch.findAll({ where: { productId: id }, transaction });
      const sumQty = batches.reduce((s, b) => s + Number(b.qty), 0);
      const delta = requestedQty - sumQty;

      if (delta > 0) {
        const batch = await addStockToBatch(id, { qty: delta, expireDate: nextExpireDate }, { transaction });
        await ensureInventoryForBatch(batch.id, id, { transaction });
        await updateInventoryForBatch(batch.id, delta, 0, id, { transaction });
        await createStockMovement(
          id, batch.id, "PURCHASE", delta,
          {
            userId: req.user ? req.user.id : null,
            referenceId: `update:product:${id}`,
            reason: "Product qty update (increase)",
            transaction,
          }
        );
        if (expireFieldProvided && nextExpireDate) {
          await ProductBatch.update(
            { expireDate: nextExpireDate },
            { where: { productId: id, qty: { [Op.gt]: 0 } }, transaction }
          );
        }
        await syncProductFromBatches(id, { transaction });
      } else if (delta < 0) {
        const absDelta = Math.abs(delta);
        const batchRows = await ProductBatch.findAll({
          where: { productId: id, qty: { [Op.gt]: 0 } },
          order: [["expireDate", "ASC NULLS LAST"]],
          transaction,
        });

        let remaining = absDelta;
        for (const batch of batchRows) {
          if (remaining <= 0) break;
          const take = Math.min(Number(batch.qty), remaining);
          await batch.update({ qty: Number(batch.qty) - take }, { transaction });
          await updateInventoryForBatch(batch.id, -take, 0, id, { transaction });
          await createStockMovement(
            id, batch.id, "ADJUSTMENT", -take,
            {
              userId: req.user ? req.user.id : null,
              referenceId: `update:product:${id}`,
              reason: "Product qty update (decrease)",
              transaction,
            }
          );
          remaining -= take;
        }

        if (remaining > 0) {
          throw new Error(`Insufficient stock for product id=${id} during update`);
        }

        if (expireFieldProvided) {
          await ProductBatch.update(
            { expireDate: nextExpireDate },
            { where: { productId: id, qty: { [Op.gt]: 0 } }, transaction }
          );
        }
        await syncProductFromBatches(id, { transaction });
      } else {
        // qty matches — just reconcile expire_date cache if the form sent it.
        if (expireFieldProvided) {
          await ProductBatch.update(
            { expireDate: nextExpireDate },
            { where: { productId: id, qty: { [Op.gt]: 0 } }, transaction }
          );
        }
        await syncProductFromBatches(id, { transaction });
      }
    } else {
      // qty not provided — only reconcile expire_date cache if the form sent it.
      if (expireFieldProvided) {
        await ProductBatch.update(
          { expireDate: nextExpireDate },
          { where: { productId: id, qty: { [Op.gt]: 0 } }, transaction }
        );
      }
      await syncProductFromBatches(id, { transaction });
    }

    await transaction.commit();

    const updatedProduct = await Product.findByPk(id, {
      include: [{ model: Category, as: "category" }],
    });

    res.json({
      success: true,
      message: "Product updated successfully",
      data: updatedProduct,
    });
  } catch (error) {
    await transaction.rollback();
    console.error("Update product error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── PATCH: Stock In (admin only) ────────────────────────
// Creates a new batch, updates Inventory, and creates a PURCHASE movement.
router.patch("/:id/stock/in", authenticate, authorizeRoles("admin"), async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { qty } = req.body;

    if (!qty || isNaN(qty) || Number(qty) <= 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "qty must be a positive number",
      });
    }

    const product = await Product.findByPk(id, { transaction });
    if (!product) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: `Product id=${id} not found`,
      });
    }

    const oldQty = product.qty;

    // Add as a new batch (no expiry) — batches are the source of truth.
    const batch = await addStockToBatch(id, { qty: Number(qty) }, { transaction });

    // Update Inventory and create PURCHASE movement
    await ensureInventoryForBatch(batch.id, id, { transaction });
    await updateInventoryForBatch(batch.id, Number(qty), 0, id, { transaction });
    await createStockMovement(
      id,
      batch.id,
      "PURCHASE",
      Number(qty),
      {
        userId: req.user ? req.user.id : null,
        referenceId: `stockIn:${batch.id}`,
        reason:      "Manual stock in",
        transaction,
      }
    );

    await transaction.commit();

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
    await transaction.rollback();
    console.error("Stock in error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── PATCH: Stock Out (admin only) ───────────────────────
// Deducts FIFO from batches, updates Inventory, and creates ADJUSTMENT
// movements for each batch affected.
router.patch("/:id/stock/out", authenticate, authorizeRoles("admin"), async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { qty, type, reason } = req.body;

    // Accept ADJUSTMENT or DAMAGE; default to ADJUSTMENT for backward compat.
    const movementType = ["ADJUSTMENT", "DAMAGE"].includes(type?.toUpperCase())
      ? type.toUpperCase()
      : "ADJUSTMENT";
    const movementReason = reason || "Manual stock out";

    if (!qty || isNaN(qty) || Number(qty) <= 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "qty must be a positive number",
      });
    }

    const product = await Product.findByPk(id, { transaction });
    if (!product) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: `Product id=${id} not found`,
      });
    }

    const oldQty = product.qty;
    const outQty = Number(qty);

    // Deduct FIFO (soonest-expiring batch first) — batches are the source of truth.
    // Skip expired batches (expireDate < today) so stock-out never touches them.
    // We replicate the FIFO logic here so we can track which batches were affected
    // and create per-batch ADJUSTMENT movements + inventory updates.
    const { Op } = require("sequelize");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);
    const batches = await ProductBatch.findAll({
      where: {
        productId: id,
        qty: { [Op.gt]: 0 },
        [Op.or]: [
          { expireDate: null },
          { expireDate: { [Op.gte]: todayStr } },
        ],
      },
      order: [["expireDate", "ASC NULLS LAST"]],
      transaction,
    });

    // Check against sellable (non-expired) batches — same filter the deduction loop uses.
    const availableQty = batches.reduce((sum, b) => sum + Number(b.qty), 0);
    if (Number(qty) > availableQty) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `Insufficient stock. Available: ${availableQty}, Requested: ${qty}`,
      });
    }

    let remaining = outQty;
    for (const batch of batches) {
      if (remaining <= 0) break;
      const take = Math.min(Number(batch.qty), remaining);
      await batch.update({ qty: Number(batch.qty) - take }, { transaction });
      await updateInventoryForBatch(batch.id, -take, 0, id, { transaction });
      await createStockMovement(
        id,
        batch.id,
        movementType,
        -take,
        {
          userId: req.user ? req.user.id : null,
          referenceId: `stockOut:product:${id}`,
          reason:      movementReason,
          transaction,
        }
      );
      remaining -= take;
    }

    if (remaining > 0) {
      throw new Error(`Insufficient stock for product id=${id}`);
    }

    await syncProductFromBatches(id, { transaction });
    await transaction.commit();

    const updated = await Product.findByPk(id);
    const newQty = updated.qty;

    res.json({
      success: true,
      message: `Stock removed successfully (-${qty})`,
      data: {
        productId:   product.id,
        name:        product.name,
        previousQty: oldQty,
        removedQty:  outQty,
        currentQty:  newQty,
      },
    });
  } catch (error) {
    await transaction.rollback();
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