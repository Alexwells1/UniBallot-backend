import "./config/cloudinary"; // initialise Cloudinary SDK at startup, before any request handler
import morgan from "morgan";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import { env } from "./config/env";
import { generalLimiter } from "./middleware/rateLimiter";
import { errorHandler, notFound } from "./middleware/errorHandler";

import authRoutes from "./routes/auth.routes";
import userRoutes from "./routes/user.routes";
import superAdminRoutes from "./routes/superAdmin.routes";
import associationRoutes from "./routes/association.routes";
import electionRoutes from "./routes/election.routes";
import candidateRoutes from "./routes/candidate.routes";
import emaildashboardRoutes from "./routes/Emaildashboard.routes";

const app = express();

app.set("trust proxy", 1);

// ── Security headers ──────────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "https://res.cloudinary.com"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
      },
    },
  }),
);
app.disable("x-powered-by"); // belt-and-suspenders even though helmet handles it

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = env.FRONTEND_ORIGIN.split(",").map((o) => o.trim());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin))
        return callback(null, true);
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// ── Body parsers ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// ── Logging ──────────────────────────────────────────────────────────────────
// FIX (Issue 14): 'dev' format in production logs colorised output and can
// expose Authorization headers / query-string tokens. Use 'combined' (Apache
// format, no color, standard fields) in production; keep 'dev' locally.
app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

// ── Global rate limiter ───────────────────────────────────────────────────────
app.use(generalLimiter);

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));

// ── API Routes ────────────────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/super-admin", superAdminRoutes);
app.use("/api/associations", associationRoutes);
app.use("/api/elections", electionRoutes);
app.use("/api/offices", candidateRoutes);
app.use("/api/email/dashboard", emaildashboardRoutes);

// ── 404 + global error handler ────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

export default app;
