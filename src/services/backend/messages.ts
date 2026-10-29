/**
 * src/services/backend/messages.ts
 * Message protocol between the content script and the service worker. The content script never
 * sees the session token and never calls the API itself (page CORS rules would apply to it):
 * it asks the service worker to perform a fixed set of operations.
 */

import type { ApiErrorBody, AuthUser, GenerateRequest, GenerateResponse, MeResponse } from '../../../shared/contract';

export const API_MESSAGE_TYPE = 'brightspace-ai/api';
export const GENERATE_PORT_NAME = 'brightspace-ai/generate';

export type ApiOp =
  | 'auth.signupStart'
  | 'auth.signup'
  | 'auth.resetStart'
  | 'auth.reset'
  | 'auth.login'
  | 'auth.logout'
  | 'session'
  | 'account.delete'
  | 'generate';

export interface ApiRequestMessage {
  type: typeof API_MESSAGE_TYPE;
  op: ApiOp;
  body?: unknown;
}

export interface ApiResponseMessage<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: ApiErrorBody;
}

export type SessionData = { signedIn: false } | ({ signedIn: true } & MeResponse);
export type VerifyData = { user: AuthUser };
export type GenerateData = GenerateResponse;
export type GenerateBody = GenerateRequest;
