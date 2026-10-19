/** Compatibility is shared by discovery, events, output health and fresh playback preflight. */
export const verifiedPlaybackSchema = 65;
export const supportsReadOnlySchema = (schema: number, minimum: number) => schema >= 28 && minimum <= 46;
