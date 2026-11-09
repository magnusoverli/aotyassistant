/** Compatibility is shared by discovery, events, output health and fresh playback preflight. */
export const verifiedPlaybackSchema = 65;
export const verifiedPlaybackSchemas: readonly number[] = [verifiedPlaybackSchema];
export const supportsPlaybackSchema = (schema: number) => verifiedPlaybackSchemas.includes(schema);
/** Earlier schema-65 releases could resume a transfer at the target's previous position. */
export function supportsQueueTransfer(schema: number, version: string): boolean {
  const release = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!supportsPlaybackSchema(schema) || !release) return false;
  const [major, minor, patch] = release.slice(1).map(Number);
  return major! > 2 || major === 2 && (minor! > 10 || minor === 10 && patch! >= 8);
}
export const supportsReadOnlySchema = (schema: number, minimum: number) => schema >= 28 && minimum <= 46;
export function playbackCompatibility(schemaVersion: number, serverVersion: string) {
  const supported = supportsPlaybackSchema(schemaVersion);
  return { supported, schemaVersion, serverVersion, verifiedSchemas: [...verifiedPlaybackSchemas],
    message: supported ? '' : `Music Assistant ${serverVersion} uses API schema ${schemaVersion}. Playback supports schema ${verifiedPlaybackSchemas.join(', ')}. Check for an app update that supports this schema. Compatible catalogue browsing remains available.` };
}
