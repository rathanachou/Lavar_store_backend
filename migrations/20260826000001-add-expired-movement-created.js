"use strict";

/**
 * Add expired_movement_created column to ProductBatches.
 *
 * This flag is set to true after the automated expiry sweep creates an
 * EXPIRED StockMovement for a batch, preventing duplicate EXPIRED
 * movements on subsequent runs.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableDesc = await queryInterface.describeTable("ProductBatches");

    if (!tableDesc.expired_movement_created) {
      await queryInterface.addColumn("ProductBatches", "expired_movement_created", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });

      await queryInterface.addIndex("ProductBatches", ["expired_movement_created"], {
        name: "idx_product_batches_expired_flag",
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("ProductBatches", "expired_movement_created");
  },
};
