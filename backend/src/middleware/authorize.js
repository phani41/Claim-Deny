import { AppError } from "../errors/app-error.js";

export const authorize = (...roles) => (request, _response, next) => {
  if (!request.auth || !roles.includes(request.auth.role)) {
    return next(new AppError(403, "FORBIDDEN", "Your account is not allowed to perform this action."));
  }
  next();
};