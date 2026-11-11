export class AppError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const notFound = (entity = "Record") => new AppError(404, "NOT_FOUND", entity + " not found.");