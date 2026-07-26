const express = require("express");

const { Customer } = require("../../models");
const router = express.Router();

router.get("", async (req, res) => {
  try {
    const customers = await Customer.findAll()

    res.json({
      data: customers
    })
  } catch (error) {
    
  }
})

router.post("", async (req, res) => {
  try {
    const customers = await Customer.findAll()

    res.json({
      data: customers
    })
  } catch (error) {
    
  }
})

module.exports = router;