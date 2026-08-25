"use strict";

/**
 * Create OrderDetailBatches table.
 *
 * Records which ProductBatch was consumed for each line of an order,
 * enabling batch-level traceability for sales, returns, and reports.
 *
 * Relationship: OrderDetails 1:N OrderDetailBatches N:1 ProductBatches
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("OrderDetailBatches", {
      id: {
        allowNull:     false,
        autoIncrement: true,
        primaryKey:    true,
        type:          Sequelize.INTEGER,
      },

      orderDetailId: {
        type:         Sequelize.INTEGER,
        allowNull:    false,
        references:   { model: "OrderDetails", key: "id" },
        onUpdate:     "CASCADE",
        onDelete:     "CASCADE",
      },

      batchId: {
        type:         Sequelize.INTEGER,
        allowNull:    false,
        references:   { model: "ProductBatches", key: "id" },
        onUpdate:     "CASCADE",
        onDelete:     "RESTRICT",
      },

      quantity: {
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

    // Index for fast lookup: which batches were used in a given order detail
    await queryInterface.addIndex("OrderDetailBatches", ["orderDetailId"], {
      name: "idx_odb_order_detail",
    });

    // Index for fast lookup: which order details consumed a given batch
    await queryInterface.addIndex("OrderDetailBatches", ["batchId"], {
      name: "idx_odb_batch",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("OrderDetailBatches");
  },
};
