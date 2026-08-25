"use strict";

/**
 * Create Inventory table.
 *
 * One Inventory row per ProductBatch, tracking available vs reserved stock.
 * The source of truth for physical stock remains ProductBatches.qty;
 * Inventory is derived from it and maintained alongside.
 *
 * Relationship: ProductBatches 1:1 Inventory
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("Inventory", {
      id: {
        allowNull:     false,
        autoIncrement: true,
        primaryKey:    true,
        type:          Sequelize.INTEGER,
      },

      batchId: {
        type:         Sequelize.INTEGER,
        allowNull:    false,
        unique:       true, // one inventory record per batch
        references:   { model: "ProductBatches", key: "id" },
        onUpdate:     "CASCADE",
        onDelete:     "CASCADE",
      },

      // Total physical stock on hand (mirrors ProductBatches.qty)
      qty: {
        type:         Sequelize.INTEGER,
        allowNull:    false,
        defaultValue: 0,
      },

      // Stock available for new orders (qty - reservedQty)
      availableQty: {
        type:         Sequelize.INTEGER,
        allowNull:    false,
        defaultValue: 0,
      },

      // Stock held by pending (not-yet-confirmed) orders
      reservedQty: {
        type:         Sequelize.INTEGER,
        allowNull:    false,
        defaultValue: 0,
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

    await queryInterface.addIndex("Inventory", ["batchId"], {
      name: "idx_inventory_batch",
    });

    await queryInterface.addIndex("Inventory", ["availableQty"], {
      name: "idx_inventory_available",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("Inventory");
  },
};
