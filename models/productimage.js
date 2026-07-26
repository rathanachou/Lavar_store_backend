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
}
    },
    {
      sequelize,
      modelName: 'ProductImage',
    }
  );

  return ProductImage;
};