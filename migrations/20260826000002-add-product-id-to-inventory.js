"use strict";

/**
 * Add productId column to Inventory and backfill from ProductBatches.
 *
 * productId mirrors ProductBatches.productId for the batch linked via
 * batchId. Two triggers keep it in sync:
 *   1. On ProductBatches INSERT: also creates the corresponding Inventory row.
 *   2. On ProductBatches UPDATE of productId: syncs the linked Inventory row.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Add productId column (nullable initially for safe backfill)
    await queryInterface.addColumn("Inventory", "productId", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "Products", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });

    await queryInterface.addIndex("Inventory", ["productId"], {
      name: "idx_inventory_product",
    });

    // 2. Backfill productId from ProductBatches for existing rows
    await queryInterface.sequelize.query(`
      UPDATE "Inventory" inv
      SET "productId" = pb."productId"
      FROM "ProductBatches" pb
      WHERE inv."batchId" = pb."id"
    `);

    // 3. Set NOT NULL after backfill
    await queryInterface.changeColumn("Inventory", "productId", {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: { model: "Products", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });

    // 4. Trigger function: when a ProductBatch is created, also create
    //    the corresponding Inventory row with the correct productId.
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION trg_create_inventory_for_batch()
      RETURNS TRIGGER AS $$
      BEGIN
        INSERT INTO "Inventory" ("batchId", "productId", "qty", "availableQty", "reservedQty")
        VALUES (NEW."id", NEW."productId", 0, 0, 0)
        ON CONFLICT ("batchId") DO UPDATE SET "productId" = EXCLUDED."productId";
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // 5. Trigger on ProductBatches INSERT: auto-create Inventory row
    await queryInterface.sequelize.query(`
      CREATE TRIGGER trg_create_inventory_for_batch
      AFTER INSERT ON "ProductBatches"
      FOR EACH ROW
      EXECUTE FUNCTION trg_create_inventory_for_batch();
    `);

    // 6. Trigger function: when a ProductBatch's productId changes,
    //    sync the linked Inventory row.
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION trg_sync_inventory_product_id()
      RETURNS TRIGGER AS $$
      BEGIN
        UPDATE "Inventory"
        SET "productId" = NEW."productId"
        WHERE "batchId" = NEW."id";
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // 7. Trigger on ProductBatches UPDATE OF productId: sync Inventory
    await queryInterface.sequelize.query(`
      CREATE TRIGGER trg_sync_inventory_product_id
      AFTER UPDATE OF "productId" ON "ProductBatches"
      FOR EACH ROW
      WHEN (OLD."productId" IS DISTINCT FROM NEW."productId")
      EXECUTE FUNCTION trg_sync_inventory_product_id();
    `);

    // 8. Final safety backfill in case anything was missed
    await queryInterface.sequelize.query(`
      UPDATE "Inventory" inv
      SET "productId" = pb."productId"
      FROM "ProductBatches" pb
      WHERE inv."batchId" = pb."id"
        AND inv."productId" IS DISTINCT FROM pb."productId"
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP TRIGGER IF EXISTS trg_sync_inventory_product_id ON "ProductBatches"`);
    await queryInterface.sequelize.query(`DROP FUNCTION IF EXISTS trg_sync_inventory_product_id()`);
    await queryInterface.sequelize.query(`DROP TRIGGER IF EXISTS trg_create_inventory_for_batch ON "ProductBatches"`);
    await queryInterface.sequelize.query(`DROP FUNCTION IF EXISTS trg_create_inventory_for_batch()`);
    await queryInterface.removeIndex("Inventory", "idx_inventory_product");
    await queryInterface.removeColumn("Inventory", "productId");
  },
};
