'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Setting extends Model {
    static associate(models) {
      // No associations needed — key/value table
    }
  }

  Setting.init({
    key: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
    },
    value: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    },
  }, {
    sequelize,
    modelName: 'Setting',
    tableName: 'Settings',
    timestamps: true,
    updatedAt: 'updatedAt',
    createdAt: false,
  });

  return Setting;
};
