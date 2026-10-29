/**
 * shared/contract.ts
 * API contract (v1) shared by the server and the extension. Types only: no runtime code,
 * so importing it from the extension adds nothing to the bundle. The server validates the same
 * shapes with zod (server/src/schemas.ts) and type-checks them against these interfaces.
 */

export const API_VERSION = 'v1';

export type ApiErrorCode =
  | 'INVALID_REQUEST'
  | 'AUTH_REQUIRED'
  | 'INVALID_CODE'
  | 'ACCOUNT_EXISTS' // sign-up for an address that already has a password: sign in instead
  | 'INSTITUTION_BLOCKED'
  | 'NOT_APPROVED' // signed in, but the owner has not approved this email address for AI usage yet
  | 'PAYMENT_REQUIRED' // reserved for later (balance used up)
  | 'PAYLOAD_TOO_LARGE'
  | 'UPGRADE_REQUIRED'
  | 'RATE_LIMITED'
  | 'DAILY_LIMIT'
  | 'CAPACITY'
  | 'UPSTREAM_ERROR'
  | 'INTERNAL'
  /** Client-side only: no connection to the server. */
  | 'NETWORK';

export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
  /** Seconds until the request may be retried (429/503). */
  retry_after?: number;
  request_id?: string;
}

/** Step 1 of sign-up: email a sign-up code to this address. */
export interface AuthSignupStartRequest {
  email: string;
}

/** Step 2 of sign-up: the emailed code proves the address, the password is used for every later sign-in. */
export interface AuthSignupRequest {
  email: string;
  code: string;
  password: string;
}

/** Forgot password, step 1: email a reset code (only sent when the address has an account with a password). */
export interface AuthResetStartRequest {
  email: string;
}

/** Forgot password, step 2: the emailed code plus the new password. Signs out every other session. */
export interface AuthResetRequest {
  email: string;
  code: string;
  password: string;
}

export interface AuthLoginRequest {
  email: string;
  password: string;
}

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthVerifyResponse {
  /** Opaque session token; send as `Authorization: Bearer <token>`. */
  token: string;
  user: AuthUser;
}

export interface HistoryTurn {
  role: 'user' | 'model';
  text: string;
}

/** A parallel chat of the student about another course (see formatRelatedChats). */
export interface RelatedChatPayload {
  course: string;
  turns: HistoryTurn[];
}

export interface GenerateRequest {
  kind: 'chat' | 'preset';
  question: string;
  history?: HistoryTurn[];
  /** The student's chats about other courses in this session, so the current chat can refer to them. */
  related_chats?: RelatedChatPayload[];
  context_markdown?: string;
  /** 'general': plain chat, the context is ignored. Missing = 'course'. */
  answer_mode?: 'course' | 'general';
  max_output_tokens?: number;
  client: {
    version: string;
    locale?: string;
    /** Hostname of the Brightspace site the student is using (used for institution blocks). */
    brightspace_host?: string;
  };
}

export interface LimitsInfo {
  /** False until the owner approves the email address: the budget is 0 until then. */
  approved: boolean;
  day_cost_cap_eur: number;
  day_cost_remaining_eur: number;
}

export interface GenerateResponse {
  request_id: string;
  text: string;
  usage: { input_tokens: number; output_tokens: number };
  limits: LimitsInfo;
}

export interface UsagePeriod {
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cost_eur: number;
}

export interface MeResponse {
  user: AuthUser;
  limits: LimitsInfo;
  usage_today: UsagePeriod;
  usage_month: UsagePeriod;
}

/** Header carrying the extension version (semver), checked against the server minimum. */
export const CLIENT_VERSION_HEADER = 'x-client-version';
