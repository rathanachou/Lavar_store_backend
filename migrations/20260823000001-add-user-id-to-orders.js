"use strict";

/**
 * Add userId column to Orders table for cashier tracking.
 *
 * Safe / idempotent: describeTable guard prevents duplicate column creation.
 * Existing orders receive NULL — no silent cashier assignment.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableDesc = await queryInterface.describeTable("Orders");

    if (!tableDesc.userId) {
      await queryInterface.addColumn("Orders", "userId", {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      });

      await queryInterface.addIndex("Orders", ["userId"], {
        name: "idx_orders_user",
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("Orders", "userId");
  },
};
