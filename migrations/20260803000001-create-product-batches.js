"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("ProductBatches", {
      id: {
        allowNull:     false,
        autoIncrement: true,
        primaryKey:    true,
        type:          Sequelize.INTEGER,
      },

      productId: {
        type:       Sequelize.INTEGER,
        allowNull:  false,
        references: {
          model: "Products",
          key:   "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },

      // Human-friendly lot reference, e.g. "LOT-2026-08-001"
      batch_number: {
        type:      Sequelize.STRING,
        allowNull: true,
      },

      qty: {
        type:         Sequelize.INTEGER,
        allowNull:    false,
        defaultValue: 0,
      },

      expire_date: {
        type:      Sequelize.DATEONLY,
        allowNull: true,
      },

      received_date: {
        type:         Sequelize.DATEONLY,
        allowNull:    false,
        defaultValue: Sequelize.literal("CURRENT_DATE"),
      },

      // Optional per-batch cost price paid to the supplier
      cost_price: {
        type:      Sequelize.DECIMAL(10, 2),
        allowNull: true,
      },

      createdAt: {
        allowNull:    false,
        type:         Sequelize.DATE,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },

      updatedAt: {
        allowNull:    false,
        type:         Sequelize.DATE,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    // Index for fast FIFO lookups: productId + expire_date
    await queryInterface.addIndex("ProductBatches", ["productId", "expire_date"], {
      name: "idx_product_batches_product_expire",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("ProductBatches");
  },
};
