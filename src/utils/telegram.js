const axios = require('axios');

/**
 * Send an arbitrary text message to the configured Telegram chat.
 * Uses TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID from environment.
 * This is fire-and-forget — errors are logged but never thrown.
 *
 * @param {string} text  The message body (supports HTML parse_mode).
 */
const sendTelegramMessage = async (text) => {
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn('⚠️ TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — skipping notification');
    return;
  }

  try {
    await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        chat_id:    CHAT_ID,
        text:       text.trim(),
        parse_mode: 'HTML',
      }
    );
    console.log('✅ Telegram notification sent!');
  } catch (error) {
    console.error('❌ Telegram error:', error.message);
  }
};

/**
 * Build a formatted order-completed message.
 */
function formatOrderMessage({ orderNumber, total, payment, items, cashier, time }) {
  return `
🛒 <b>New Order Completed</b>
━━━━━━━━━━━━━━━━━━━━
🧾 <b>Order #:</b> ${orderNumber}
💰 <b>Total:</b> $${total}
💳 <b>Payment:</b> ${payment}
📦 <b>Items:</b> ${items}
👤 <b>Cashier:</b> ${cashier}
🕐 <b>Time:</b> ${time}
━━━━━━━━━━━━━━━━━━━━
  `.trim();
}

module.exports = { sendTelegramMessage, formatOrderMessage };
