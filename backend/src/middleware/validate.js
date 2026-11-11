import { AppError } from "../errors/app-error.js";

export function validate(schemas) {
  return (request, _response, next) => {
    request.validated = request.validated || {};
    for (const [part, schema] of Object.entries(schemas)) {
      const parsed = schema.safeParse(request[part]);
      if (!parsed.success) {
        return next(new AppError(400, "VALIDATION_ERROR", "Request validation failed.",
          parsed.error.issues.map((issue) => ({
            path: issue.path.join("."), code: issue.code, message: issue.message
          }))));
      }
      request.validated[part] = parsed.data;
    }
    next();
  };
}