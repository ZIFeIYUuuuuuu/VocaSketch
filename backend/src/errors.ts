import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    details: Record<string, unknown>;
  };
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly details: Record<string, unknown>;

  constructor(options: {
    statusCode: number;
    code: string;
    message: string;
    retryable?: boolean;
    details?: Record<string, unknown>;
  }) {
    super(options.message);
    this.name = "ApiError";
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.details = options.details ?? {};
  }
}

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

export function validationError(error: ZodError): ApiError {
  return new ApiError({
    statusCode: 400,
    code: "REQUEST_INVALID",
    message: "请求参数不合法。",
    details: {
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    }
  });
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(
    new ApiError({
      statusCode: 404,
      code: "NOT_FOUND",
      message: `接口不存在：${req.method} ${req.path}`
    })
  );
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  let apiError: ApiError;

  if (err instanceof ApiError) {
    apiError = err;
  } else if (err instanceof SyntaxError && "body" in err) {
    apiError = new ApiError({
      statusCode: 400,
      code: "REQUEST_INVALID_JSON",
      message: "请求 JSON 格式不合法。"
    });
  } else {
    apiError = new ApiError({
      statusCode: 500,
      code: "INTERNAL_ERROR",
      message: "服务内部错误。",
      retryable: true
    });
  }

  const body: ErrorResponse = {
    error: {
      code: apiError.code,
      message: apiError.message,
      retryable: apiError.retryable,
      details: apiError.details
    }
  };

  res.status(apiError.statusCode).json(body);
};
