const nodemailer = require("nodemailer");

// Debug: verify env vars are loaded before first use
console.log("[Mailer] SMTP_HOST =", process.env.SMTP_HOST);
console.log("[Mailer] SMTP_PORT =", process.env.SMTP_PORT);
console.log("[Mailer] SMTP_USER =", process.env.SMTP_USER);
console.log("[Mailer] SMTP_SECURE =", process.env.SMTP_SECURE);
console.log("[Mailer] SMTP_PASS set =", !!process.env.SMTP_PASS);

let _transporter = null;
function getTransporter() {
  if (!_transporter) {
    console.log("[Mailer] Creating transporter with host:", process.env.SMTP_HOST, "port:", process.env.SMTP_PORT);
    _transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587", 10),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return _transporter;
}

/**
 * Send a verification email to the given address with the provided token.
 * The email contains a link: `${APP_URL}/verify-email?token=<token>`
 *
 * @param {string} toEmail - Recipient email address
 * @param {string} token   - Secure random verification token
 */
const sendVerificationEmail = async (toEmail, token) => {
  const appUrl = process.env.APP_URL || "http://localhost:5173";
  const verifyLink = `${appUrl}/verify-email?token=${token}`;

  const html = `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Verify your email</title>
  </head>
  <body style="font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 24px;">
    <table align="center" width="100%" cellpadding="0" cellspacing="0" style="max-width: 480px; margin: 0 auto;">
      <tr>
        <td style="background: #ffffff; border-radius: 8px; padding: 32px;">
          <h1 style="font-size: 22px; margin: 0 0 16px;">Verify your email address</h1>
          <p style="color: #555; line-height: 1.6; margin: 0 0 24px;">
            Thank you for creating an account. Please click the button below to verify your email address.
            This link expires in 24 hours.
          </p>
          <!--[if mso]>
          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
            href="${verifyLink}" style="height:44px;v-text-anchor:middle;width:200px;" arcsize="10%" strokecolor="#000"
            fillcolor="#000">
            <w:anchorlock/>
            <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;">
              Verify Email
            </center>
          </v:roundrect>
          <![endif]-->
          <!--[if !mso]><!-->
          <a href="${verifyLink}"
            style="display: inline-block; background: #000; color: #fff; text-decoration: none;
                   font-size: 14px; font-weight: bold; padding: 12px 28px; border-radius: 6px;">
            Verify Email
          </a>
          <!--<![endif]-->
          <p style="color: #999; font-size: 13px; line-height: 1.5; margin: 24px 0 0;">
            Or copy and paste this link in your browser:<br />
            <a href="${verifyLink}" style="color: #666; word-break: break-all;">${verifyLink}</a>
          </p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
          <p style="color: #999; font-size: 12px; margin: 0;">
            If you did not create this account, please ignore this email.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

  const info = await getTransporter().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: toEmail,
    subject: "Verify your email address — LEVA Store POS",
    html,
  });

  console.log(`[Mailer] Verification email sent to ${toEmail} — messageId: ${info.messageId}`);
};

/**
 * Send a password-reset email with a secure token link.
 *
 * @param {string} toEmail - Recipient email address
 * @param {string} token   - Secure random reset token (1-hour expiry)
 */
const sendResetPasswordEmail = async (toEmail, token) => {
  const appUrl = process.env.APP_URL || "http://localhost:5173";
  const resetLink = `${appUrl}/reset-password?token=${token}`;

  const html = `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Reset your password</title>
  </head>
  <body style="font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 24px;">
    <table align="center" width="100%" cellpadding="0" cellspacing="0" style="max-width: 480px; margin: 0 auto;">
      <tr>
        <td style="background: #ffffff; border-radius: 8px; padding: 32px;">
          <h1 style="font-size: 22px; margin: 0 0 16px;">Reset your password</h1>
          <p style="color: #555; line-height: 1.6; margin: 0 0 24px;">
            You recently requested to reset your password. Click the button below to set a new one.
            This link expires in 1 hour.
          </p>
          <!--[if mso]>
          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
            href="${resetLink}" style="height:44px;v-text-anchor:middle;width:200px;" arcsize="10%" strokecolor="#000"
            fillcolor="#000">
            <w:anchorlock/>
            <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;">
              Reset Password
            </center>
          </v:roundrect>
          <![endif]-->
          <!--[if !mso]><!-->
          <a href="${resetLink}"
            style="display: inline-block; background: #000; color: #fff; text-decoration: none;
                   font-size: 14px; font-weight: bold; padding: 12px 28px; border-radius: 6px;">
            Reset Password
          </a>
          <!--<![endif]-->
          <p style="color: #999; font-size: 13px; line-height: 1.5; margin: 24px 0 0;">
            Or copy and paste this link in your browser:<br />
            <a href="${resetLink}" style="color: #666; word-break: break-all;">${resetLink}</a>
          </p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
          <p style="color: #999; font-size: 12px; margin: 0;">
            If you did not request a password reset, please ignore this email.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

  const info = await getTransporter().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: toEmail,
    subject: "Reset your password — LEVA Store POS",
    html,
  });

  console.log(`[Mailer] Password-reset email sent to ${toEmail} — messageId: ${info.messageId}`);
};

module.exports = { sendVerificationEmail, sendResetPasswordEmail };
