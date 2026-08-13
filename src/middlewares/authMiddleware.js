const jwt = require("jsonwebtoken");

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Tokens issued before the role migration have no role claim.
    // Return 401 so the frontend clears the stale token and prompts re-login,
    // instead of a 403 that leaves the user stuck with a forever-invalid token.
    if (!req.user.role) {
      return res.status(401).json({
        message: "Session expired — please log in again to refresh your permissions.",
      });
    }

    const hasRole = roles.includes(req.user.role);

    if (!hasRole) {
      return res.status(403).json({
        message: `Access denied. Required role: ${roles.join(" or ")}`,
      });
    }

    return next();
  };
};

// Aliases for backward compatibility
const authMiddleware = authenticate;
const requireRole    = authorizeRoles;

module.exports = { authenticate, authorizeRoles, authMiddleware, requireRole };