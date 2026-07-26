'use strict';

const bcrypt = require('bcrypt');

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.bulkInsert('Users', [
      {
        firstName: 'Super',
        lastName: 'Admin',
        email: 'rathana3296@gmail.com',
        password: await bcrypt.hash('1234', 10),
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
      email: 'rathana3296@gmail.com',
    });
  },
};