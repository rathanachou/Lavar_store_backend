"use strict";

/**
 * Create StockMovements table.
 *
 * Immutable audit trail for every stock change. Each record documents
 * what happened, to which product/batch, in what quantity, and why.
 *
 * Relationship: Inventory 1:N StockMovements
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("StockMovements", {
      id: {
        allowNull:     false,
        autoIncrement: true,
        primaryKey:    true,
        type:          Sequelize.INTEGER,
      },

      productId: {
        type:         Sequelize.INTEGER,
        allowNull:    false,
        references:   { model: "Products", key: "id" },
        onUpdate:     "CASCADE",
        onDelete:     "RESTRICT",
      },

      batchId: {
        type:         Sequelize.INTEGER,
        allowNull:    false,
        references:   { model: "ProductBatches", key: "id" },
        onUpdate:     "CASCADE",
        onDelete:     "RESTRICT",
      },

      // Movement type: PURCHASE | SALE | RETURN | ADJUSTMENT | DAMAGE | EXPIRED
      type: {
        type:         Sequelize.STRING(20),
        allowNull:    false,
      },

      // Positive for stock increase, negative for stock decrease
      quantity: {
        type:         Sequelize.INTEGER,
        allowNull:    false,
      },

      // Optional reference: orderId, orderDetailId, etc.
      referenceId: {
        type:         Sequelize.STRING,
        allowNull:    true,
      },

      // Human-readable reason (e.g. "Order #123", "Damage during handling")
      reason: {
        type:         Sequelize.STRING,
        allowNull:    true,
      },

      createdAt: {
        allowNull:    false,
        type:         Sequelize.DATE,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    await queryInterface.addIndex("StockMovements", ["productId", "createdAt"], {
      name: "idx_sm_product_created",
    });

    await queryInterface.addIndex("StockMovements", ["batchId", "createdAt"], {
      name: "idx_sm_batch_created",
    });

    await queryInterface.addIndex("StockMovements", ["type"], {
      name: "idx_sm_type",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("StockMovements");
  },
};
