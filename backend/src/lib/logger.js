import pino from "pino";
import pinoHttp from "pino-http";
import { env } from "../config/env.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: "hlt06-backend" },
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", "password", "passwordHash", "token", "apiKey", "email"],
    censor: "[REDACTED]"
  }
});

export const httpLogger = pinoHttp({
  logger,
  serializers: {
    req(request) {
      return { id: request.id, method: request.method, url: String(request.url || "").split("?")[0] };
    },
    res(response) { return { statusCode: response.statusCode }; }
  },
  customLogLevel(_request, response, error) {
    if (error || response.statusCode >= 500) return "error";
    if (response.statusCode >= 400) return "warn";
    return "info";
  }
});