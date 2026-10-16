export class RequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}

/** One bounded JSON request; a timeout never implies that a mutation was not committed. */
export async function requestJson<T>(path: string, data?: unknown, timeoutMs = 15_000): Promise<T> {
  const response = await fetch(appPath(path), {
    cache: 'no-store', signal: AbortSignal.timeout(timeoutMs),
    ...(data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  });
  let payload;
  try { payload = await response.json(); }
  catch { throw new RequestError('The server returned an unreadable response. Refresh before trying again.', response.status); }
  if (!response.ok) throw new RequestError(typeof payload?.error === 'string' ? payload.error : 'The request could not be completed.', response.status, payload?.code);
  return payload as T;
}
import { appPath } from './paths';
