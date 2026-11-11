import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import { logger } from "../lib/logger.js";

export async function postAiService(path, payload) {
  const token = env.AI_SERVICE_TOKEN;
  if (!token) throw new AppError(503, "AI_SERVICE_UNAVAILABLE", "The internal AI service is not configured.");
  let response;
  try {
    response = await fetch(new URL(path, env.AI_SERVICE_URL), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + token
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(300000)
    });
  } catch (error) {
    logger.warn({ requestId: "-", errorName: error?.name || "Error" }, "Internal AI service request failed");
    throw new AppError(503, "AI_SERVICE_UNAVAILABLE", "The internal AI service could not be reached.");
  }

  let body = {};
  try { body = await response.json(); } catch { body = {}; }
  if (!response.ok) {
    const status = response.status === 415 || response.status === 422 ? 422 : 503;
    const detailMsg = typeof body?.detail === "string" ? body.detail : null;
    const code = status === 422
      ? (detailMsg && (detailMsg.includes("Invalid Document") || detailMsg.includes("medical or healthcare") || detailMsg.includes("password") || detailMsg.includes("corrupted") || detailMsg.includes("empty"))
          ? "INVALID_HEALTHCARE_DOCUMENT"
          : "AI_INPUT_REJECTED")
      : "AI_SERVICE_UNAVAILABLE";
    const message = detailMsg || (status === 422
      ? "The AI service could not process this document or request."
      : "The internal AI service is temporarily unavailable.");
    throw new AppError(status, code, message);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError(502, "AI_INVALID_RESPONSE", "The internal AI service returned an invalid response.");
  }
  return body;
}
