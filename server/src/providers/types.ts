export interface ProviderTurn {
  role: 'user' | 'model';
  text: string;
}

export interface ProviderRequest {
  system: string;
  /** Alternating user/model turns, starting and ending with a user turn. */
  turns: ProviderTurn[];
  maxOutputTokens: number;
  temperature: number;
  signal?: AbortSignal;
}

export interface ProviderResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export type ProviderFailure = 'RATE_LIMITED' | 'UPSTREAM_ERROR';

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: ProviderFailure,
    readonly status?: number,
    readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface Provider {
  readonly name: string;
  readonly model: string;
  generate(req: ProviderRequest): Promise<ProviderResponse>;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
