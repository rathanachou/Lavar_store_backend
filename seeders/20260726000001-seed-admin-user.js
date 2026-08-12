'use strict';

const bcrypt = require('bcrypt');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.bulkInsert('Users', [
      {
        firstName: 'Admin',
        lastName: 'User',
        email: 'rathana3296@gmail.com',
        password: await bcrypt.hash('admin123', 10),
        role: 'admin',
        email_verified: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('Users', {
      email: 'admin@levastore.com',
    });
  },
};
