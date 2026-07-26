'use strict';
const { Model } = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class User extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  User.init({
    firstName: DataTypes.STRING,
    lastName: DataTypes.STRING,
    email: DataTypes.STRING,
    password: DataTypes.STRING,
    gender: DataTypes.STRING,
    isActive: DataTypes.BOOLEAN,
    role: {
      type:         DataTypes.ENUM("admin", "cashier"),
      allowNull:    false,
      defaultValue: "cashier",
    },
    email_verified: {
      type:         DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull:    false,
    },
    verification_token: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    verification_token_expires: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    reset_password_token: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    reset_password_expires: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'User',
  });
  return User;
};
