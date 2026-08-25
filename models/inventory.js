"use strict";
const { Model } = require("sequelize");
module.exports = (sequelize, DataTypes) => {
  class Inventory extends Model {
    static associate(models) {
      Inventory.belongsTo(models.ProductBatch, {
        foreignKey: "batchId",
        as: "productBatch",
      });
    }
  }

  Inventory.init(
    {
      batchId: {
        type:      DataTypes.INTEGER,
        allowNull: false,
        unique:    true,
      },
      qty: {
        type:      DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      availableQty: {
        type:      DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      reservedQty: {
        type:      DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      sequelize,
      modelName: "Inventory",
      tableName: "Inventory",
    }
  );

  return Inventory;
};
