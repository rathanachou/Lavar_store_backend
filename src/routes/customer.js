const express = require("express");

const { Customer } = require("../../models");
const { authenticate } = require("../middlewares/authMiddleware");
const router = express.Router();

router.get("", authenticate, async (req, res) => {
  try {
    const customers = await Customer.findAll()

    res.json({
      data: customers
    })
  } catch (error) {
    
  }
})

router.post("", authenticate, async (req, res) => {
  try {
    const customers = await Customer.findAll()

    res.json({
      data: customers
    })
  } catch (error) {
    
  }
})

module.exports = router;