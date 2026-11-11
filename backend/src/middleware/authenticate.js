import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import { userRepository } from "../data-access/repositories.js";
import { asyncHandler } from "./async-handler.js";

export const authenticate = asyncHandler(async (request, _response, next) => {
  const match = (request.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  const token = match ? match[1] : (request.query?.token || null);
  if (!token) throw new AppError(401, "UNAUTHORIZED", "A valid bearer token is required.");
  let payload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"] });
  } catch {
    throw new AppError(401, "UNAUTHORIZED", "The bearer token is invalid or expired.");
  }
  if (!payload || typeof payload !== "object" || typeof payload.sub !== "string") {
    throw new AppError(401, "UNAUTHORIZED", "The bearer token is invalid or expired.");
  }
  const user = await userRepository.findPublicIdentity(payload.sub);
  if (!user) throw new AppError(401, "UNAUTHORIZED", "The account is no longer available.");
  if (user.active === false) throw new AppError(401, "UNAUTHORIZED", "Account is deactivated.");
  request.auth = user;
  next();
});