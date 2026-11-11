import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CORS_ORIGIN: z.string().default("http://127.0.0.1:5173"),
  DATABASE_URL: z.string().startsWith("file:"),
  JWT_SECRET: z.string().min(32).refine((v) => !v.startsWith("replace-with-"), "Replace the JWT_SECRET example value."),
  JWT_EXPIRES_IN: z.string().default("8h"),
  AI_SERVICE_URL: z.string().url().default("http://127.0.0.1:8000"),
  AI_SERVICE_TOKEN: z.string().optional().refine((v) => v === undefined || v.length >= 32, "AI_SERVICE_TOKEN must contain at least 32 characters."),
  UPLOADS_DIR: z.string().min(1).default("./uploads"),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(20).default(10),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info")
});
export const env = schema.parse(process.env);
