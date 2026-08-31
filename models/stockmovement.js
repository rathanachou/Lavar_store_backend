"use strict";
const { Model } = require("sequelize");
module.exports = (sequelize, DataTypes) => {
  class StockMovement extends Model {
    static associate(models) {
      StockMovement.belongsTo(models.User, {
        foreignKey: "userId",
        as: "user",
      });
      StockMovement.belongsTo(models.Product, {
        foreignKey: "productId",
        as: "product",
      });
      StockMovement.belongsTo(models.ProductBatch, {
        foreignKey: "batchId",
        as: "productBatch",
      });
    }
  }

  StockMovement.init(
    {
      productId: {
        type:      DataTypes.INTEGER,
        allowNull: false,
      },
      batchId: {
        type:      DataTypes.INTEGER,
        allowNull: false,
      },
      type: {
        type:      DataTypes.STRING(20),
        allowNull: false,
      },
      quantity: {
        type:      DataTypes.INTEGER,
        allowNull: false,
      },
      userId: {
        type:      DataTypes.INTEGER,
        allowNull: true,
      },
      referenceId: {
        type:      DataTypes.STRING,
        allowNull: true,
      },
      reason: {
        type:      DataTypes.STRING,
        allowNull: true,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      modelName: "StockMovement",
      timestamps: true,
      updatedAt: false,
    }
  );

  return StockMovement;
};
