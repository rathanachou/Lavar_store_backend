"use strict";
const { Model } = require("sequelize");
module.exports = (sequelize, DataTypes) => {
  class OrderDetailBatch extends Model {
    static associate(models) {
      OrderDetailBatch.belongsTo(models.OrderDetail, {
        foreignKey: "orderDetailId",
        as: "orderDetail",
      });
      OrderDetailBatch.belongsTo(models.ProductBatch, {
        foreignKey: "batchId",
        as: "productBatch",
      });
    }
  }

  OrderDetailBatch.init(
    {
      orderDetailId: {
        type:      DataTypes.INTEGER,
        allowNull: false,
      },
      batchId: {
        type:      DataTypes.INTEGER,
        allowNull: false,
      },
      quantity: {
        type:      DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      modelName: "OrderDetailBatch",
    }
  );

  return OrderDetailBatch;
};
