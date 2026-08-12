require("dotenv").config();
const express = require("express");
const db      = require("./models");
const cors    = require("cors");

const authRoute      = require("./src/routes/auth");
const customerRoute  = require("./src/routes/customer");
const userRoute      = require("./src/routes/user");
const productRoute   = require("./src/routes/product");
const orderRoute     = require("./src/routes/order");
const categoryRoute  = require("./src/routes/category");
const dashboardRoute = require("./src/routes/dashboard");
const paymentRoute   = require("./src/routes/payment");
const settingsRoute  = require("./src/routes/settings");
const reportRoute    = require("./src/routes/report");

const { authenticate, authorizeRoles } = require("./src/middlewares/authMiddleware");

const app  = express();
const port = process.env.PORT || 3000;

// Allowed origins:
//  - Exact production URL (from FRONTEND_URL env var)
//  - Any Vercel preview deployment for this project (lavar-store-*.vercel.app)
//  - Any localhost origin (dev)
//  - Requests with no Origin header (server-to-server, curl, Postman)
const corsOriginPattern = /^https:\/\/lavar-store(-[a-z0-9-]+)?\.vercel\.app$/;
const frontendUrl = (process.env.FRONTEND_URL || "").trim();

console.log("CORS allowed origins:", [
  ...(frontendUrl ? [frontendUrl] : []),
  "http://localhost:*",
  "https://lavar-store.vercel.app",
  "https://lavar-store-*.vercel.app (preview)",
]);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, curl, Postman)
    if (!origin) return callback(null, true);
    // Allow any localhost origin (dev)
    if (origin.startsWith("http://localhost")) return callback(null, true);
    // Allow exact production URL if configured
    if (origin === frontendUrl) return callback(null, true);
    // Allow any preview deployment: lavar-store-<id>.vercel.app
    if (corsOriginPattern.test(origin)) return callback(null, true);
    // Log rejected origins for debugging
    console.warn(`CORS blocked origin: ${origin}`);
    callback(new Error("Not allowed by CORS"));
  },
  methods: "GET,POST,PUT,DELETE,PATCH",
  credentials: true,
}));

app.use(express.json());

db.sequelize
  .authenticate()
  .then(() => console.log("Database connected successfully"))
  .catch((err) => console.error("Unable to connect to database:", err));

// ─── Public Routes ─────────────────────────────────────────────────────────
app.use("/api/v1/auth", authRoute);

app.use("/api/v1/payments/callback", paymentRoute);
app.use("/api/v1/settings", settingsRoute);

// ─── Authenticated Routes ──────────────────────────────────────────────────
app.use("/api/v1/orders",     authenticate, orderRoute);
app.use("/api/v1/products",   authenticate, productRoute);
app.use("/api/v1/categories", authenticate, categoryRoute);


app.use("/api/v1/payments",   authenticate, paymentRoute);

// ─── Admin Only ────────────────────────────────────────────────────────────
app.use("/api/v1/users",     authenticate, authorizeRoles("admin"), userRoute);
app.use("/api/v1/dashboard", authenticate, authorizeRoles("admin"), dashboardRoute);
app.use("/api/v1/reports",   authenticate, authorizeRoles("admin"), reportRoute);

// ─── Central error handler ─────────────────────────────────
// CORS rejections (callback(new Error(...))) and body-parser errors land here.
// Convert them to a clean JSON response instead of Express's HTML error page,
// so the frontend can read response.status / response.message / response.error.
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  console.error("[Error-handler]", {
    status,
    method: req.method,
    url: req.originalUrl,
    origin: req.headers.origin,
    name: err.name,
    message: err.message,
    stack: err.stack,
  });

  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({
      message: "Not allowed by CORS",
      error: `Origin ${req.headers.origin} is not permitted`,
    });
  }

  if (status === 413) {
    return res.status(413).json({ message: "Payload too large" });
  }

  res.status(status).json({
    message: status >= 500 ? "Internal server error" : err.message || "Request failed",
    error: err.message,
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});