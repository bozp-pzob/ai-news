// src/middleware/errorMiddleware.ts

import { Request, Response, NextFunction } from 'express';
import { logger } from '../helpers/cliHelper';

/**
 * Custom application error class with HTTP status code support.
 * Use this in route handlers to throw errors that the error middleware
 * will catch and format consistently.
 *
 * @example
 * throw new AppError('Config not found', 404);
 * throw new AppError('Insufficient permissions', 403);
 * throw AppError.badRequest('Invalid config JSON');
 * throw AppError.notFound('Config');
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly code?: string;

  constructor(message: string, statusCode: number = 500, code?: string, isOperational: boolean = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.code = code;
    
    // Preserve proper stack trace
    Object.setPrototypeOf(this, AppError.prototype);
    Error.captureStackTrace(this, this.constructor);
  }

  // Convenience factory methods
  static badRequest(message: string, code?: string): AppError {
    return new AppError(message, 400, code);
  }

  static unauthorized(message: string = 'Not authenticated'): AppError {
    return new AppError(message, 401, 'UNAUTHORIZED');
  }

  static forbidden(message: string = 'Insufficient permissions'): AppError {
    return new AppError(message, 403, 'FORBIDDEN');
  }

  static notFound(resource: string = 'Resource'): AppError {
    return new AppError(`${resource} not found`, 404, 'NOT_FOUND');
  }

  static conflict(message: string): AppError {
    return new AppError(message, 409, 'CONFLICT');
  }

  static tooManyRequests(message: string = 'Too many requests'): AppError {
    return new AppError(message, 429, 'RATE_LIMITED');
  }

  static internal(message: string = 'Internal server error'): AppError {
    return new AppError(message, 500, 'INTERNAL_ERROR', false);
  }

  static paymentRequired(message: string, payment?: Record<string, any>): AppError {
    const err = new AppError(message, 402, 'PAYMENT_REQUIRED');
    (err as any).payment = payment;
    return err;
  }
}

/**
 * Centralized Express error-handling middleware.
 * 
 * Catches all errors thrown or passed via next(error) in route handlers
 * and returns a consistent JSON error response.
 * 
 * MUST be registered AFTER all routes in the Express app.
 * 
 * @example
 * // In api.ts:
 * app.use('/api/v1', v1Routes);
 * app.use(errorMiddleware); // After all routes
 */
export function errorMiddleware(
  err: Error | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Determine status code and message
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const isOperational = err instanceof AppError ? err.isOperational : false;

  // Log error details
  if (statusCode >= 500) {
    logger.error(`${err.message}`, {
      statusCode,
      stack: err.stack,
      isOperational,
    });
  } else {
    // Client errors (4xx) - log at a lower severity
    logger.warn(`${statusCode} - ${err.message}`);
  }

  // Build response
  const response: Record<string, any> = {
    error: isOperational ? err.message : 'Internal server error',
    statusCode,
  };

  // Include error code if available
  if (err instanceof AppError && err.code) {
    response.code = err.code;
  }

  // Include payment details for 402 errors
  if (err instanceof AppError && (err as any).payment) {
    response.payment = (err as any).payment;
  }

  // Include stack trace in development
  if (process.env.NODE_ENV === 'development' && err.stack) {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
}

/**
 * Wrapper to handle async route handlers automatically.
 * Catches rejected promises and passes them to the error middleware.
 * 
 * @example
 * router.get('/foo', asyncHandler(async (req, res) => {
 *   const data = await someAsyncOp(); // If this throws, error middleware catches it
 *   res.json(data);
 * }));
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export default errorMiddleware;
