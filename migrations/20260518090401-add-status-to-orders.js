"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const tableDesc = await queryInterface.describeTable("Orders");

    if (!tableDesc.status) {
      await queryInterface.addColumn("Orders", "status", {
        type: Sequelize.ENUM("pending", "completed", "cancelled"),
        allowNull: false,
        defaultValue: "pending",
      });
    }
    if (!tableDesc.cancelledAt) {
      await queryInterface.addColumn("Orders", "cancelledAt", {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }
    if (!tableDesc.cancelReason) {
      await queryInterface.addColumn("Orders", "cancelReason", {
        type: Sequelize.STRING,
        allowNull: true,
      });
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn("Orders", "status");
    await queryInterface.removeColumn("Orders", "cancelledAt");
    await queryInterface.removeColumn("Orders", "cancelReason");
  },
};