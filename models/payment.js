"use strict";
const { Model } = require("sequelize");
module.exports = (sequelize, DataTypes) => {
  class Payment extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  Payment.init(
    {
      orderId: DataTypes.INTEGER,
      paywayTranId: DataTypes.STRING,
      method: DataTypes.STRING,
      status: DataTypes.STRING,
      paidAt: DataTypes.DATE,
      remark: DataTypes.TEXT,
      amount: DataTypes.DECIMAL,
    },
    {
      sequelize,
      modelName: "Payment",
    },
  );
  return Payment;
};