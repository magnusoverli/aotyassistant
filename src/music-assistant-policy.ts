/** Compatibility is shared by discovery, events, output health and fresh playback preflight. */
export const verifiedPlaybackSchema = 65;
export const verifiedPlaybackSchemas: readonly number[] = [verifiedPlaybackSchema];
export const supportsPlaybackSchema = (schema: number) => verifiedPlaybackSchemas.includes(schema);
export const supportsReadOnlySchema = (schema: number, minimum: number) => schema >= 28 && minimum <= 46;
export function playbackCompatibility(schemaVersion: number, serverVersion: string) {
  const supported = supportsPlaybackSchema(schemaVersion);
  return { supported, schemaVersion, serverVersion, verifiedSchemas: [...verifiedPlaybackSchemas],
    message: supported ? '' : `Music Assistant ${serverVersion} uses API schema ${schemaVersion}. Live playback is verified for schema ${verifiedPlaybackSchemas.join(', ')}. Update Albums of the Year for support; browsing remains available.` };
}
