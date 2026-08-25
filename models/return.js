"use strict";
const { Model } = require("sequelize");
module.exports = (sequelize, DataTypes) => {
  class Return extends Model {
    static associate(models) {
      Return.belongsTo(models.Order, {
        foreignKey: "orderId",
        as: "order",
      });
      Return.belongsTo(models.OrderDetail, {
        foreignKey: "orderDetailId",
        as: "orderDetail",
      });
      Return.belongsTo(models.Product, {
        foreignKey: "productId",
        as: "product",
      });
      Return.belongsTo(models.ProductBatch, {
        foreignKey: "batchId",
        as: "productBatch",
      });
      Return.belongsTo(models.User, {
        foreignKey: "processedBy",
        as: "processedByUser",
      });
    }
  }

  Return.init(
    {
      orderId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      orderDetailId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      productId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      batchId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      quantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      refundAmount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      reason: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      refundMethod: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("PENDING", "COMPLETED", "CANCELLED"),
        allowNull: false,
        defaultValue: "PENDING",
      },
      processedBy: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "Return",
      tableName: "Returns",
    }
  );

  return Return;
};
