import type { ApiErrorCode as SharedCode } from '../../shared/contract.js';

/** 'NETWORK' only exists on the client. */
type ApiErrorCode = Exclude<SharedCode, 'NETWORK'>;

const STATUS: Record<ApiErrorCode, number> = {
  INVALID_REQUEST: 400,
  AUTH_REQUIRED: 401,
  INVALID_CODE: 401,
  ACCOUNT_EXISTS: 409,
  INSTITUTION_BLOCKED: 403,
  NOT_APPROVED: 403,
  PAYMENT_REQUIRED: 402,
  PAYLOAD_TOO_LARGE: 413,
  UPGRADE_REQUIRED: 426,
  RATE_LIMITED: 429,
  DAILY_LIMIT: 429,
  CAPACITY: 503,
  UPSTREAM_ERROR: 502,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly retryAfter?: number;

  /** Alias read by Fastify plugins that throw this error. */
  get statusCode(): number {
    return this.status;
  }

  constructor(code: ApiErrorCode, message: string, retryAfter?: number) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS[code];
    this.retryAfter = retryAfter;
  }
}
