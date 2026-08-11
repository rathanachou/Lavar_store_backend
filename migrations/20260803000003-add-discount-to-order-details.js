"use strict";

/**
 * Add a per-line discount column to OrderDetails so the per-product
 * near-expiry discount is persisted as its own number instead of being
 * silently baked into `amount`.
 *
 * Backfill: for existing rows, discount = (productPrice * qty) - amount.
 * Rows created before this feature will either have a positive discount
 * (product was discounted at checkout) or 0 (no discount), so the backfill
 * is safe and backward compatible.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("OrderDetails", "discount", {
      type:         Sequelize.DECIMAL(10, 2),
      allowNull:    false,
      defaultValue: 0,
    });

    // Backfill existing rows where the line total already included a discount.
    await queryInterface.sequelize.query(`
      UPDATE "OrderDetails"
      SET discount = ROUND((COALESCE("productPrice", 0) * COALESCE("qty", 0) - COALESCE("amount", 0))::numeric, 2)
      WHERE COALESCE("productPrice", 0) * COALESCE("qty", 0) > COALESCE("amount", 0);
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn("OrderDetails", "discount");
  },
};
