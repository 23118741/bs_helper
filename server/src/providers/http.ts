import { ProviderError, type FetchLike } from './types.js';

/** POSTs JSON and maps transport and HTTP failures to ProviderError. */
export async function postJson(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal
): Promise<any> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err: any) {
    throw new ProviderError(`Provider unreachable: ${err?.message || err}`, 'UPSTREAM_ERROR');
  }

  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      // ignore
    }
    const retryAfter = Number(res.headers.get('retry-after')) || undefined;
    if (res.status === 429) {
      throw new ProviderError(`Provider rate limit (429) ${detail}`, 'RATE_LIMITED', 429, retryAfter ?? 30);
    }
    throw new ProviderError(`Provider error ${res.status} ${detail}`, 'UPSTREAM_ERROR', res.status);
  }

  try {
    return await res.json();
  } catch {
    throw new ProviderError('Provider returned invalid JSON', 'UPSTREAM_ERROR', res.status);
  }
}
