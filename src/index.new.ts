// Load environment variables FIRST, before any other imports
import * as dotenv from "dotenv";
import path from "path";
import type { Request, Response, NextFunction } from "express";

// Load env from current directory
const possiblePaths = [
  path.join(process.cwd(), ".env.local"),
  path.join(process.cwd(), ".env"),
];

for (const envPath of possiblePaths) {
  const result = dotenv.config({ path: envPath });
  if (!result.error && process.env.MONGODB_URI) {
    console.log("Loaded env from: " + envPath);
    break;
  }
}

// Validate critical env vars before proceeding
if (!process.env.MONGODB_URI) {
  console.error("MONGODB_URI is not defined in environment variables");
  console.error("Make sure .env or .env.local exists with MONGODB_URI set");
  process.exit(1);
}

// Now dynamically import everything else AFTER env is loaded
async function main() {
  const express = (await import("express")).default;
  const cors = (await import("cors")).default;
  const cookieParser = (await import("cookie-parser")).default;
  const { toNodeHandler } = await import("better-auth/node");
  const { auth } = await import("./lib/auth.js");
  const { connectDB } = await import("./lib/db/mongoose.js");
  const { authMiddleware } = await import("./middleware/auth.js");

  // Import API routes (new structure)
  const apiRoutes = (await import("./api/routes/index.js")).default;

  // Import files routes (keeping separate as it may have special handling)
  const filesRoutes = (await import("./routes/files.js")).default;

  const app = express();
  const PORT = process.env.PORT || 5432;

  // Middleware
  app.use(cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
  }));
  app.use(cookieParser());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Better Auth handler - must be before other routes
  // Express 5 requires named wildcard parameters
  app.all("/api/auth/*path", toNodeHandler(auth));

  // API Routes (new clean structure)
  app.use("/api", authMiddleware, apiRoutes);

  // Files routes (may have special upload handling)
  app.use("/api/files", filesRoutes);

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "ok", 
      timestamp: new Date().toISOString(),
      port: PORT,
      environment: process.env.NODE_ENV || "development"
    });
  });

  // Error handling middleware
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    console.error("Error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  });

  // Start server
  try {
    await connectDB();
    console.log("Connected to MongoDB");

    app.listen(PORT, () => {
      console.log("YT Auto Backend Server running on http://localhost:" + PORT);
      console.log("Frontend URL: " + (process.env.FRONTEND_URL || "http://localhost:3000"));
      console.log("Environment: " + (process.env.NODE_ENV || "development"));
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

main();
