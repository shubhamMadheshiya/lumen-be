export class AppError extends Error {
  public readonly statusCode: number;
  public readonly errors?: unknown[];

  constructor(message: string, statusCode = 500, errors?: unknown[]) {
    super(message);
    this.statusCode = statusCode;
    this.errors = errors;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  static notFound(message = 'Not found'): AppError {
    return new AppError(message, 404);
  }

  static forbidden(message = 'Forbidden'): AppError {
    return new AppError(message, 403);
  }

  static badRequest(message: string, errors?: unknown[]): AppError {
    return new AppError(message, 400, errors);
  }

  static unauthorized(message = 'Unauthorized'): AppError {
    return new AppError(message, 401);
  }

  static conflict(message: string): AppError {
    return new AppError(message, 409);
  }
}
