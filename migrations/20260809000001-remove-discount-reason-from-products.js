"use strict";

/** @type {import("sequelize-cli").Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.removeColumn("Products", "discount_reason");
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn("Products", "discount_reason", {
      type: Sequelize.STRING,
      allowNull: true,
    });
  },
};
