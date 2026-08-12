"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Currency the customer paid in at the POS (display currency at checkout).
    // Existing orders default to USD.
    await queryInterface.addColumn("Orders", "currency", {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: "USD",
    });

    // Riel amount actually paid, when currency = "KHR". Riel has no cents so
    // the column is DECIMAL(12, 0). NULL when paid in USD — the report sums
    // this column to show the Riel total without needing the exchange rate.
    await queryInterface.addColumn("Orders", "amount_khr", {
      type: Sequelize.DECIMAL(12, 0),
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn("Orders", "amount_khr");
    await queryInterface.removeColumn("Orders", "currency");
  },
};
