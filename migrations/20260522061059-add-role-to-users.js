"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const tableDesc = await queryInterface.describeTable("Users");

    if (!tableDesc.role) {
      await queryInterface.addColumn("Users", "role", {
        type:         Sequelize.ENUM("admin", "cashier"),
        allowNull:    false,
        defaultValue: "cashier",
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("Users", "role");
  },
};