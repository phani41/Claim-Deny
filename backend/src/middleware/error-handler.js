import { Prisma } from "@prisma/client";
import { AppError } from "../errors/app-error.js";
import { logger } from "../lib/logger.js";

export function notFoundHandler(_request, _response, next) {
  next(new AppError(404, "NOT_FOUND", "Route not found."));
}
export function errorHandler(error, request, response, _next) {
  if (response.headersSent) return;
  let normalized = error;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      const target = Array.isArray(error.meta?.target) ? error.meta.target.join(", ") : String(error.meta?.target || "");
      let detailMsg = "A record with that value already exists.";
      if (target.includes("claimNumber")) {
        detailMsg = "A claim with this claim number already exists. Please choose a unique claim number or add documents to the existing claim.";
      } else if (target.includes("evidenceId") || target.includes("appealLetterId")) {
        detailMsg = "This evidence citation is already attached to the appeal letter.";
      } else if (target.includes("email")) {
        detailMsg = "An account with this email address already exists.";
      } else if (target.includes("name")) {
        detailMsg = "A record with this name already exists.";
      }
      normalized = new AppError(409, "CONFLICT", detailMsg);
    } else if (error.code === "P2003" || error.code === "P2025") {
      normalized = new AppError(404, "NOT_FOUND", "Related record not found.");
    } else {
      normalized = new AppError(500, "DATABASE_ERROR", "The database operation failed.");
    }
  } else if (error?.name === "MulterError") {
    if (error.code === "LIMIT_FILE_SIZE") normalized = new AppError(413, "UPLOAD_TOO_LARGE", "The document exceeds the upload size limit.");
    else normalized = new AppError(400, "INVALID_UPLOAD", "Upload exactly one PDF or DOCX file with the required fields.");
  } else if (error instanceof SyntaxError && "body" in error) {
    normalized = new AppError(400, "INVALID_JSON", "Request body must contain valid JSON.");
  }
  const known = normalized instanceof AppError;
  const status = known ? normalized.status : 500;
  const code = known ? normalized.code : "INTERNAL_ERROR";
  const message = known ? normalized.message : "An unexpected error occurred.";
  if (status >= 500) logger.error({ requestId: request.id, code, errorName: error?.name || "Error", stack: error?.stack, message: error?.message }, "Request failed");
  response.status(status).json({
    code, message,
    ...(known && normalized.details ? { details: normalized.details } : {}),
    requestId: request.id
  });
}
