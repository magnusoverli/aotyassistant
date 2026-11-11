import type { UserDirectory } from '../src/model';
import { appPath } from './paths';

/** An open user picker/settings list follows photos even for users outside the listening order. */
export function watchUserDirectory(host: boolean, signal: AbortSignal, accept: (directory: UserDirectory) => void) {
  const source = new EventSource(appPath(host ? '/api/host/users/events' : '/api/participant/identity/events'));
  source.addEventListener('state', event => {
    if (signal.aborted) return;
    try {
      const directory = JSON.parse((event as MessageEvent).data) as UserDirectory;
      if (Array.isArray(directory.users)) accept(directory);
    } catch { /* A malformed event does not replace the last confirmed directory. */ }
  });
  const close = () => source.close();
  signal.addEventListener('abort', close, { once: true });
  return () => { close(); signal.removeEventListener('abort', close); };
}
