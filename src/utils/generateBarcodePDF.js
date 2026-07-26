const bwipjs = require("bwip-js");
const PDFDocument = require("pdfkit");

/**
 * Generate PDF with barcode labels for products
 * @param {Array} products - Array of { id, name, price }
 * @returns {Promise<Buffer>} PDF buffer
 */
const generateBarcodePDF = async (products) => {
  const doc = new PDFDocument({
    size: [141.73, 85.04], // 50mm x 30mm label size
    margin: 5,
    autoFirstPage: false,
  });

  const buffers = [];
  doc.on("data", buffers.push.bind(buffers));

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    doc.addPage();

    try {
      // ─── Generate Barcode PNG ───────────────────────────
      const png = await bwipjs.toBuffer({
        bcid: "code128",
        text: String(product.id),
        scale: 2,
        height: 8,
        includetext: false,
        padding: 2,
      });

      // ─── Product Name ───────────────────────────────────
      doc
        .fontSize(7)
        .font("Helvetica-Bold")
        .text(
          product.name.length > 25
            ? product.name.substring(0, 25) + "..."
            : product.name,
          5,
          5,
          { align: "center", width: 131 }
        );

      // ─── Barcode Image ──────────────────────────────────
      doc.image(png, 15, 18, { width: 110, height: 35 });

      // ─── Product ID ─────────────────────────────────────
      doc
        .fontSize(6)
        .font("Helvetica")
        .text(`ID: ${product.id}`, 5, 55, { align: "center", width: 131 });

      // ─── Price ──────────────────────────────────────────
      doc
        .fontSize(8)
        .font("Helvetica-Bold")
        .text(`$${Number(product.price).toFixed(2)}`, 5, 65, {
          align: "center",
          width: 131,
        });

    } catch (err) {
      console.error(`Failed to generate barcode for product ${product.id}:`, err);

      doc
        .fontSize(7)
        .font("Helvetica-Bold")
        .text(product.name, 5, 20, { align: "center", width: 131 });

      doc
        .fontSize(8)
        .font("Helvetica-Bold")
        .text(`$${Number(product.price).toFixed(2)}`, 5, 55, {
          align: "center",
          width: 131,
        });
    }
  }

  doc.end();

  return new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);
  });
};

module.exports = generateBarcodePDF;