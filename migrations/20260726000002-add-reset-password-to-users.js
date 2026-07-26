'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("Users", "reset_password_token", {
      type: Sequelize.STRING(255),
      allowNull: true,
    });

    await queryInterface.addColumn("Users", "reset_password_expires", {
      type: Sequelize.DATE,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("Users", "reset_password_token");
    await queryInterface.removeColumn("Users", "reset_password_expires");
  },
};
