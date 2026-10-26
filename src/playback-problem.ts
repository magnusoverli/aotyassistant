import { UpstreamError } from './upstream-error.js';

const messages = {
  'connection-lost': 'Playback status could not be checked after reconnecting attempts. The speaker may still be playing.',
  authorization: 'Music Assistant rejected this app’s access. The host needs to check the connection in Settings.',
  'speaker-unavailable': 'The selected speaker or its queue is unavailable in Music Assistant. The speaker may still be playing.',
  'unsupported-response': 'Music Assistant returned a playback response this app cannot safely interpret. The host needs to check version compatibility.',
  'state-unconfirmed': 'Music Assistant could not confirm whether the speaker is playing, paused or stopped. The speaker may still be playing.',
  'play-unconfirmed': 'The song could not be verified as playing. It may have started; no alternative recording was substituted.',
  'setup-unconfirmed': 'The speaker’s single-track queue settings could not be verified. The app did not send a new Play command; the previous song may still be playing.',
  'pause-unconfirmed': 'Pause could not be confirmed. The speaker may still be playing.',
  'resume-unconfirmed': 'Resume could not be confirmed. Playback may have resumed.',
  'stop-unconfirmed': 'Stop could not be confirmed. The speaker may still be playing. The turn was not advanced.',
  'queue-unverified': 'The playback queue could not be safely verified. The turn was not advanced.',
  'queue-policy': 'The speaker’s queue changed to allow extra tracks, repeat, shuffle or autoplay. Stopping could not be confirmed.',
  'queue-policy-stopped': 'The speaker’s queue changed to allow extra tracks, repeat, shuffle or autoplay. App-owned playback was stopped to prevent unwanted music; your turn was kept. Select a song again when ready.',
  'external-playback': 'Playback changed outside this app. Other audio was left untouched. You can select a song again when ready.',
  'external-stop': 'Playback stopped without a confirmed natural end. Your turn was kept; select a song or pass the turn.',
  'recovery-unconfirmed': 'Playback recovery could not confirm that the app-owned song stopped. Check the connection and try recovery again.',
} as const;

export type PlaybackProblemCode = keyof typeof messages;
export type PlaybackProblem = { code: PlaybackProblemCode; message: string; recoveryRequired: boolean };

export function playbackProblem(code: PlaybackProblemCode): PlaybackProblem {
  return { code, message: messages[code], recoveryRequired: !['external-playback', 'external-stop', 'queue-policy-stopped'].includes(code) };
}

export function playbackFailure(error: unknown, fallback: PlaybackProblemCode): PlaybackProblemCode {
  if (error instanceof UpstreamError) {
    if (error.kind === 'authorization' || error.kind === 'unsupported-response' || error.kind === 'state-unconfirmed') return error.kind;
    if (error.kind === 'destination-unavailable') return 'speaker-unavailable';
  }
  return fallback;
}
