"use strict";
const { Model } = require("sequelize");
module.exports = (sequelize, DataTypes) => {
  class ProductBatch extends Model {
    static associate(models) {
      ProductBatch.belongsTo(models.Product, {
        foreignKey: "productId",
        as: "product",
      });
    }
  }

  ProductBatch.init(
    {
      productId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      batchNumber: {
        type: DataTypes.STRING,
        field: "batch_number",
        allowNull: true,
      },
      qty: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      expireDate: {
        type: DataTypes.DATEONLY,
        field: "expire_date",
        allowNull: true,
      },
      receivedDate: {
        type: DataTypes.DATEONLY,
        field: "received_date",
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      costPrice: {
        type: DataTypes.DECIMAL(10, 2),
        field: "cost_price",
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "ProductBatch",
    }
  );

  return ProductBatch;
};
