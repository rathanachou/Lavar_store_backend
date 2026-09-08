'use strict';

/**
 * Create Settings table for generic key/value application settings.
 *
 * This table stores configurable values (e.g. monthly sales target) as
 * key/value pairs so new settings don't require new migrations.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Settings', {
      key: {
        type: Sequelize.STRING(100),
        allowNull: false,
        primaryKey: true,
      },
      value: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('Settings', ['key'], {
      name: 'idx_settings_key',
      unique: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('Settings');
  },
};
