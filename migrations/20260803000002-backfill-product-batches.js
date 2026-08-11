"use strict";

/**
 * One-time backfill: seed a single ProductBatch per existing Product that has
 * qty > 0, copying qty and expire_date from the Product record. This keeps
 * Products.qty / Products.expire_date as a denormalized cache while making
 * ProductBatches the source of truth going forward.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      INSERT INTO "ProductBatches"
        ("productId", "qty", "expire_date", "received_date", "createdAt", "updatedAt")
      SELECT
        id,
        qty,
        expire_date,
        CURRENT_DATE,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      FROM "Products"
      WHERE qty > 0;
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`DELETE FROM "ProductBatches";`);
  },
};
