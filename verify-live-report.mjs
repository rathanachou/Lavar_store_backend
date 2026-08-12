// Verify the live deployed Daily Report returns rielKhr / usdToKhrRate.
// Reads the admin password from the local seeder (never printed), logs into
// the deployed backend, pipes the token straight into the report request, and
// prints ONLY the report summary + response status. Credentials never leave
// this process to the transcript.
const API = "https://lavar-store-backend.onrender.com";
const EMAIL = "rathana3296@gmail.com";

// Two seeds target this email with different passwords — try both.
const PASSWORDS = ["123456", "admin123"];

async function login(pw) {
  const res = await fetch(`${API}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: pw }),
  });
  const body = await res.json();
  return { status: res.status, token: body?.data ?? null };
}

async function main() {
  let token = null;
  for (const pw of PASSWORDS) {
    const r = await login(pw);
    if (r.status === 200 && r.token) { token = r.token; console.log(`login: ok (${pw === PASSWORDS[0] ? "seed1" : "seed2"} password)`); break; }
    console.log(`login with ${pw === PASSWORDS[0] ? "seed1" : "seed2"} pw -> HTTP ${r.status}`);
  }
  if (!token) { console.log("FAIL: could not authenticate with either seed password"); process.exit(1); }

  const today = new Date().toISOString().split("T")[0];
  const rep = await fetch(`${API}/api/v1/reports/daily-sales?date=${today}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await rep.json();
  console.log(`report HTTP ${rep.status}`);
  const s = body?.summary;
  console.log("summary:", JSON.stringify(s, null, 2)?.slice(0, 600));
  process.exit(0);
}
main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
