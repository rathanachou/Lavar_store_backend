"use strict";
const { Model } = require("sequelize");
module.exports = (sequelize, DataTypes) => {
  class OrderDetail extends Model {
    static associate(models) {
      OrderDetail.belongsTo(models.Order, {
        foreignKey: "orderId",
        as: "order",
      });
    }
  }

  OrderDetail.init(
    {
      orderId: DataTypes.INTEGER,
      productId: DataTypes.INTEGER,
      productName: DataTypes.STRING,
      productPrice: DataTypes.DECIMAL(10, 2),
      qty: DataTypes.INTEGER,
      amount: DataTypes.DECIMAL(10, 2),
      discount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      sequelize,
      modelName: "OrderDetail",
    }
  );

  return OrderDetail;
};