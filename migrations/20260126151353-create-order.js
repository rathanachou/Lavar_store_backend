// migrations/xxxx-create-orders.js — Code ពេញលេញ
"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("Orders", {
      id: {
        allowNull:     false,
        autoIncrement: true,
        primaryKey:    true,
        type:          Sequelize.INTEGER,
      },

 
      customerId: {
        type:       Sequelize.INTEGER,
        allowNull:  true,
        references: {
          model: "Customers",
          key:   "id",
        },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },

      orderNumber: {
        type:      Sequelize.STRING,
        allowNull: false,
        unique:    true,
      },

      total: {
        type:         Sequelize.DECIMAL(10, 2),
        allowNull:    false,
        defaultValue: 0,
      },

      discount: {
        type:         Sequelize.DECIMAL(10, 2),
        allowNull:    false,
        defaultValue: 0,
      },

      status: {
        type:         Sequelize.ENUM("pending", "completed", "cancelled"),
        allowNull:    false,
        defaultValue: "pending",
      },

      orderDate: {
        type:         Sequelize.DATE,
        allowNull:    false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },

      location: {
        type:         Sequelize.TEXT,
        allowNull:    true,
        defaultValue: "N/A",
      },

      
      cancelledAt: {
        type:      Sequelize.DATE,
        allowNull: true,
      },

      cancelReason: {
        type:      Sequelize.STRING,
        allowNull: true,
      },

      createdAt: {
        allowNull: false,
        type:      Sequelize.DATE,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },

      updatedAt: {
        allowNull: false,
        type:      Sequelize.DATE,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

  
    await queryInterface.addIndex("Orders", ["status"], {
      name: "idx_orders_status",
    });

    await queryInterface.addIndex("Orders", ["customerId"], {
      name: "idx_orders_customerid",
    });

    await queryInterface.addIndex("Orders", ["orderDate"], {
      name: "idx_orders_orderdate",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("Orders");
  },
};