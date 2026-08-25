"use strict";

/**
 * Add userId column to StockMovements for audit trail (cashier/admin tracking).
 *
 * Safe / idempotent: describeTable guard prevents duplicate column creation.
 * Existing movements receive NULL — no silent user assignment.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableDesc = await queryInterface.describeTable("StockMovements");

    if (!tableDesc.userId) {
      await queryInterface.addColumn("StockMovements", "userId", {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      });

      await queryInterface.addIndex("StockMovements", ["userId"], {
        name: "idx_sm_user",
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("StockMovements", "userId");
  },
};
