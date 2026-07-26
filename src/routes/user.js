const express  = require("express");
const bcrypt   = require("bcryptjs");
const { User } = require("../../models");
const router   = express.Router();

// GET /api/v1/users
router.get("/", async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: { exclude: ["password"] },
      order: [["createdAt", "DESC"]],
    });
    return res.json({ success: true, data: users });
  } catch (error) {
    console.error("Get users error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// DELETE /api/v1/users/:id
router.delete("/:id", async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    await user.destroy();
    return res.json({ success: true, message: "User deleted successfully" });
  } catch (error) {
    console.error("Delete user error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

router.patch("/:id/reset-password", async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
    }
    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    return res.json({ success: true, message: "Password reset successfully" });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

module.exports = router;