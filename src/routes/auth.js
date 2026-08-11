const express  = require("express");
const bcrypt   = require("bcryptjs");
const jwt      = require("jsonwebtoken");
const crypto   = require("crypto");
const { User } = require("../../models");
const { sendVerificationEmail, sendResetPasswordEmail } = require("../utils/mailer");

const router = express.Router();

// ─── Register ─────────────────────────────────────────────
router.post("/register", async (req, res) => {
  try {
    const { firstName, lastName, email, password, gender, role } = req.body;

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Normalize to lowercase so the case-sensitive role ENUM and gender column
    // accept any input casing ("Admin"→"admin", "Male"→"male").
    const normalizedRole   = String(role || "cashier").toLowerCase();
    const normalizedGender = String(gender || "").toLowerCase();

    if (!["admin", "cashier"].includes(normalizedRole)) {
      return res.status(400).json({ message: "Role must be 'admin' or 'cashier'" });
    }

    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ message: "Email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate verification token (24-hour expiry)
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const verificationTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const user = await User.create({
      firstName, lastName, email,
      password: hashedPassword,
      gender: normalizedGender,
      role: normalizedRole,
      email_verified: false,
      verification_token: verificationToken,
      verification_token_expires: verificationTokenExpires,
    });

    // Send verification email (fire-and-forget — don't block registration on email failure)
    sendVerificationEmail(email, verificationToken).catch((err) =>
      console.error("[Mailer] Failed to send verification email:", err.message)
    );

    const userData = user.toJSON();
    delete userData.password;
    delete userData.verification_token;
    delete userData.verification_token_expires;

    return res.status(201).json({
      message: "User registered successfully. Please verify your email.",
      data: userData,
    });
  } catch (error) {
    console.error("Register error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// ─── Verify Email ─────────────────────────────────────────
router.get("/verify-email", async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ message: "Verification token is required" });
    }

    const user = await User.findOne({
      where: {
        verification_token: token,
        verification_token_expires: { [require("sequelize").Op.gt]: new Date() },
      },
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired verification token" });
    }

    user.email_verified = true;
    user.verification_token = null;
    user.verification_token_expires = null;
    await user.save();

    return res.json({
      message: "Email verified successfully. You can now log in.",
    });
  } catch (error) {
    console.error("Verify email error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// ─── Login ────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ where: { email } });
    console.log("[Login] Found user:", { id: user?.id, email: user?.email, email_verified: user?.email_verified, hasPassword: !!user?.password, passwordLength: user?.password?.length });
    if (!user) {
      return res.status(404).json({ message: `User email=${email} not found` });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    console.log("[Login] bcrypt.compare result:", isMatch);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid password" });
    }

    // [REMOVED] Email verification check — login no longer blocked by email_verified status
    // console.log("[Login] email_verified check:", user.email_verified);
    // if (!user.email_verified) {
    //   return res.status(403).json({
    //     message: "Please verify your email before logging in. Check your inbox or request a new verification email.",
    //     code: "EMAIL_NOT_VERIFIED",
    //   });
    // }

    const token = jwt.sign(
      {
        id:       user.id,
        email:    user.email,
        fullName: user.firstName + " " + user.lastName,
        role:     user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "2d" }
    );

    return res.json({
      message: "User logged in successfully",
      data: token,
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// ─── Resend Verification Email ────────────────────────────
router.post("/resend-verification", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(404).json({ message: "No account found with this email" });
    }

    if (user.email_verified) {
      return res.status(400).json({ message: "Email is already verified" });
    }

    // Generate new token
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const verificationTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    user.verification_token = verificationToken;
    user.verification_token_expires = verificationTokenExpires;
    await user.save();

    // Send the email
    sendVerificationEmail(email, verificationToken).catch((err) =>
      console.error("[Mailer] Failed to resend verification email:", err.message)
    );

    return res.json({
      message: "Verification email resent. Please check your inbox.",
    });
  } catch (error) {
    console.error("Resend verification error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// ─── Forgot Password ───────────────────────────────────────
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await User.findOne({ where: { email } });

    // Always respond with the same message — don't leak which emails are registered
    if (!user) {
      return res.json({
        message: "If that email is registered, you will receive a password reset link shortly.",
      });
    }

    // Generate secure token (1-hour expiry)
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    user.reset_password_token = resetToken;
    user.reset_password_expires = resetExpires;
    await user.save();

    // Send the email (fire-and-forget)
    sendResetPasswordEmail(email, resetToken).catch((err) =>
      console.error("[Mailer] Failed to send reset-password email:", err.message)
    );

    return res.json({
      message: "If that email is registered, you will receive a password reset link shortly.",
    });
  } catch (error) {
    console.error("Forgot-password error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// ─── Reset Password (token-based) ─────────────────────────
router.post("/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    // Validate input
    if (!token || !newPassword) {
      return res.status(400).json({
        message: "Token and new password are required",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        message: "Password must be at least 6 characters",
      });
    }

    // Find user by valid token
    const { Op } = require("sequelize");
    const user = await User.findOne({
      where: {
        reset_password_token: token,
        reset_password_expires: { [Op.gt]: new Date() },
      },
    });

    if (!user) {
      return res.status(400).json({
        message: "Invalid or expired reset token. Please request a new password reset.",
      });
    }

    // Hash new password and save, then clear token fields
    user.password = await bcrypt.hash(newPassword, 10);
    user.reset_password_token = null;
    user.reset_password_expires = null;
    await user.save();

    return res.json({
      message: "Password reset successfully. You can now log in with your new password.",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;
