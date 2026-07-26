"use strict";
const { Model } = require("sequelize");
module.exports = (sequelize, DataTypes) => {
  class Product extends Model {
    static associate(models) {
      Product.belongsTo(models.Category, {
        foreignKey: "categoryId",
        as: "category",
      });

      Product.hasMany(models.ProductImage, {
        foreignKey: "productId",
        as: "productImages",
      });

      Product.hasMany(models.OrderDetail, {
        foreignKey: "productId",
        as: "orderDetails",
      });
    }
  }

  Product.init(
    {
      name: DataTypes.STRING,
      categoryId: DataTypes.INTEGER,
      price: DataTypes.DECIMAL,
      qty: DataTypes.INTEGER,
      isActive: DataTypes.BOOLEAN,
      barcode: DataTypes.STRING,
      sku: DataTypes.STRING,
    },
    {
      sequelize,
      modelName: "Product",
    }
  );

  return Product;
};