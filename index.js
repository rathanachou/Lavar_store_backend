const express = require("express");
const db      = require("./models");
const cors    = require("cors");
require("dotenv").config();

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

const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "https://www.abc.com",
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || origin.startsWith("http://localhost")) {
      callback(null, true);
    } else if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
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

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});