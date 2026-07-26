'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("Users", "email_verified", {
      type: Sequelize.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    });

    await queryInterface.addColumn("Users", "verification_token", {
      type: Sequelize.STRING(255),
      allowNull: true,
    });

    await queryInterface.addColumn("Users", "verification_token_expires", {
      type: Sequelize.DATE,
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn("Users", "email_verified");
    await queryInterface.removeColumn("Users", "verification_token");
    await queryInterface.removeColumn("Users", "verification_token_expires");
  },
};
