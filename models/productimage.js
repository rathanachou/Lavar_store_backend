'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class ProductImage extends Model {
    static associate(models) {
      ProductImage.belongsTo(models.Product, {
        foreignKey: "productId",
        as: "product",
      });
    }
  } 

  ProductImage.init(
    {
      productId: DataTypes.INTEGER,
      imageUrl: DataTypes.STRING,
      fileName: DataTypes.STRING,
      publicId: {
        type: DataTypes.STRING,
        allowNull: true,
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
      modelName: 'ProductImage',
    }
  );

  return ProductImage;
};