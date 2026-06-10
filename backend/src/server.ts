import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import path from "path";
import fs from "fs";
import { config } from "./config";
import { logger } from "./middleware/logger";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import routes from "./routes/index";
import prisma from "./db";

const app = express();

app.use(helmet());
app.use(compression());
app.use(cors({
  origin:         config.cors.origins,
  methods:        ["GET","POST","PUT","DELETE","PATCH","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"],
  credentials:    true,
}));
if (!config.server.isDev) {
  app.use(rateLimit({
    windowMs: config.rateLimit.windowMs,
    max:      config.rateLimit.max,
    message:  { success:false, error:{ message:"Too many requests, slow down.", code:"RATE_LIMITED" } },
  }));
}
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(logger);

app.use("/api/v1", routes);

// Serve React frontend if dist exists (production)
const frontendDist = path.join(__dirname, "../../frontend/dist");
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
} else {
  app.use(notFoundHandler);
}

app.use(errorHandler);

async function bootstrap() {
  try {
    await prisma.$connect();
    console.log("✅ Database connected");

    app.listen(config.server.port, () => {
      console.log(`🚀 SpendWise API running on http://localhost:${config.server.port}`);
      console.log(`📦 Environment: ${config.server.env}`);
      console.log(`🔗 Health: http://localhost:${config.server.port}/api/v1/health`);
    });
  } catch (err) {
    console.error("❌ Failed to start server:", err);
    process.exit(1);
  }
}

process.on("SIGTERM", async () => {
  console.log("SIGTERM received, closing DB connection...");
  await prisma.$disconnect();
  process.exit(0);
});

bootstrap();
