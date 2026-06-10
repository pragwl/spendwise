import dotenv from "dotenv";
dotenv.config();

export const config = {
  server: {
    port:    parseInt(process.env.PORT || "4000", 10),
    env:     process.env.NODE_ENV || "development",
    isDev:   process.env.NODE_ENV !== "production",
  },
  db: {
    url: process.env.DATABASE_URL || "",
  },
  cors: {
    origins: (process.env.ALLOWED_ORIGINS || "http://localhost:5173")
      .split(",")
      .map(o => o.trim()),
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000", 10),
    max:      parseInt(process.env.RATE_LIMIT_MAX || "100", 10),
  },
  log: {
    level: process.env.LOG_LEVEL || "dev",
  },
  pagination: {
    defaultLimit: 50,
    maxLimit:     200,
  },
};
