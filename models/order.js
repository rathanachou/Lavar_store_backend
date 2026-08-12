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
      // Currency the customer actually paid in at the POS ("USD" | "KHR").
      // The store's ledger/Order.total is always USD; this records the display
      // currency chosen at checkout so the Daily Report can show Riel totals.
      currency: {
        type:         DataTypes.STRING,
        allowNull:    false,
        defaultValue: "USD",
      },
      // Riel amount paid when currency = "KHR"; NULL for USD orders.
      // DECIMAL(12,0) because Riel has no cents. Pre-converted at order create
      // using ABA_PAYWAY_KHR_RATE so the report never needs to convert.
      amountKhr: {
        type:         DataTypes.DECIMAL(12, 0),
        field:        "amount_khr",
        allowNull:    true,
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