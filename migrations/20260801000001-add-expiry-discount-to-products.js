"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Expiration date for tracking near-expiry products
    await queryInterface.addColumn("Products", "expire_date", {
      type: Sequelize.DATEONLY,
      allowNull: true,
    });

    // Near-expiry discount — percent applied at checkout
    await queryInterface.addColumn("Products", "discount_percent", {
      type: Sequelize.DECIMAL(5, 2),
      allowNull: false,
      defaultValue: 0,
    });

    // Optional note describing why the discount was set (e.g. "expiring soon")
    await queryInterface.addColumn("Products", "discount_reason", {
      type: Sequelize.STRING,
      allowNull: true,
    });

    // Index for fast near-expiry lookups
    await queryInterface.addIndex("Products", ["expire_date"], {
      name: "products_expire_date_idx",
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex("Products", "products_expire_date_idx");
    await queryInterface.removeColumn("Products", "discount_reason");
    await queryInterface.removeColumn("Products", "discount_percent");
    await queryInterface.removeColumn("Products", "expire_date");
  },
};
