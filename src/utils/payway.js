const crypto = require("crypto");

function getReqTime() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

function signPayWay(raw) {
  return crypto
    .createHmac("sha512", process.env.ABA_PAYWAY_API_KEY)
    .update(raw)
    .digest("base64");
}

function buildPurchaseHash(payload) {
  // Official 24-field purchase hash per ABA PayWay docs (order is fixed).
  const raw =
    payload.req_time +
    payload.merchant_id +
    payload.tran_id +
    payload.amount +
    payload.items +
    payload.shipping +
    payload.firstname +
    payload.lastname +
    payload.email +
    payload.phone +
    payload.type +
    payload.payment_option +
    payload.return_url +
    payload.cancel_url +
    payload.continue_success_url +
    payload.return_deeplink +
    payload.currency +
    payload.custom_fields +
    payload.return_params +
    payload.payout +
    payload.lifetime +
    payload.additional_params +
    payload.google_pay_token +
    payload.skip_success_page;

  return signPayWay(raw);
}

const encodeBase64 = (str) => {
  return Buffer.from(str).toString("base64");
};

function buildCheckTransactionHash({ req_time, merchant_id, tran_id }) {
  const raw = req_time + merchant_id + tran_id;
  return signPayWay(raw);
}

module.exports = {
  getReqTime,
  buildPurchaseHash,
  encodeBase64,
  buildCheckTransactionHash,
};
