"use strict";

/**
 * Create Returns table.
 *
 * Records every product return from a completed order, tracking the original
 * order/detail/batch, refund amount, reason, method, and status.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("Returns", {
      id:             { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      orderId:        { type: Sequelize.INTEGER, allowNull: false },
      orderDetailId:  { type: Sequelize.INTEGER, allowNull: false },
      productId:      { type: Sequelize.INTEGER, allowNull: false },
      batchId:        { type: Sequelize.INTEGER, allowNull: false },
      quantity:       { type: Sequelize.INTEGER, allowNull: false },
      refundAmount:   { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      reason:         { type: Sequelize.STRING, allowNull: true },
      refundMethod:   { type: Sequelize.STRING, allowNull: true },
      status:         { type: Sequelize.ENUM("PENDING", "COMPLETED", "CANCELLED"), allowNull: false, defaultValue: "PENDING" },
      processedBy:    { type: Sequelize.INTEGER, allowNull: true },
      createdAt:      { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt:      { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });

    await queryInterface.addIndex("Returns", ["orderId"],       { name: "idx_returns_order" });
    await queryInterface.addIndex("Returns", ["orderDetailId"], { name: "idx_returns_order_detail" });
    await queryInterface.addIndex("Returns", ["productId"],     { name: "idx_returns_product" });
    await queryInterface.addIndex("Returns", ["batchId"],       { name: "idx_returns_batch" });
    await queryInterface.addIndex("Returns", ["status"],        { name: "idx_returns_status" });
    await queryInterface.addIndex("Returns", ["processedBy"],   { name: "idx_returns_processed_by" });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("Returns");
  }
};
