// models/order.js
"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Order extends Model {
    static associate(models) {
      Order.belongsTo(models.Customer, {
        foreignKey: "customerId",
        as:         "customer",
      });
      Order.hasMany(models.OrderDetail, {
        foreignKey: "orderId",
        as:         "orderDetails",
      });
    }
  }

  Order.init(
    {
      customerId: {
        type:      DataTypes.INTEGER,
        allowNull: true,
      },
      orderNumber: {
        type:      DataTypes.STRING,
        allowNull: false,
        unique:    true,
      },
      total: {
        type:         DataTypes.DECIMAL(10, 2),
        allowNull:    false,
        defaultValue: 0,
      },
      discount: {
        type:         DataTypes.DECIMAL(10, 2),
        allowNull:    false,
        defaultValue: 0,
      },
      status: {
        type:         DataTypes.ENUM("pending", "completed", "cancelled"),
        allowNull:    false,
        defaultValue: "pending", 
      },
      orderDate: {
        type:         DataTypes.DATE,
        allowNull:    false,
        defaultValue: DataTypes.NOW,
      },
      location: {
        type:         DataTypes.TEXT,
        allowNull:    true,
        defaultValue: "N/A",
      },
      cancelledAt: {
        type:      DataTypes.DATE,
        allowNull: true,
      },
      cancelReason: {
        type:      DataTypes.STRING,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "Order",
    }
  );

  return Order;
};