"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Add barcode column
    await queryInterface.addColumn("Products", "barcode", {
      type: Sequelize.STRING,
      allowNull: true,
      unique: true,
    });

    // Add SKU column
    await queryInterface.addColumn("Products", "sku", {
      type: Sequelize.STRING,
      allowNull: true,
    });

    // Add index on barcode for fast O(1) lookups
    await queryInterface.addIndex("Products", ["barcode"], {
      name: "products_barcode_idx",
      unique: true,
      where: { barcode: { [Sequelize.Op.ne]: null } },
    });

    // Add index on sku for fast lookups
    await queryInterface.addIndex("Products", ["sku"], {
      name: "products_sku_idx",
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex("Products", "products_sku_idx");
    await queryInterface.removeIndex("Products", "products_barcode_idx");
    await queryInterface.removeColumn("Products", "sku");
    await queryInterface.removeColumn("Products", "barcode");
  },
};
