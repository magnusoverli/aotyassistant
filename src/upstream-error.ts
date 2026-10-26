import { AppError } from './model.js';

export type UpstreamFailure = 'connection' | 'timeout' | 'unavailable' | 'destination-unavailable' | 'state-unconfirmed' | 'authorization' | 'unsupported-response' | 'rejected' | 'closed';

/** Machine-readable, sanitized failures. Never classify failures by matching human copy. */
export class UpstreamError extends AppError {
  constructor(public readonly kind: UpstreamFailure, status: number, message: string) { super(status, message); }
}

export function retryableRead(error: unknown): boolean {
  return error instanceof UpstreamError ? ['connection', 'timeout', 'unavailable', 'destination-unavailable', 'state-unconfirmed'].includes(error.kind)
    : error instanceof AppError && error.status === 504;
}
