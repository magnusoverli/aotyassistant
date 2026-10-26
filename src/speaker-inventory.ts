/** Runtime observations only; saved routing preferences are never inventory evidence. */
export const speakerFreshnessMs = 45_000;
export type SpeakerInventory = {
  state: 'not-configured' | 'loading' | 'refreshing' | 'verified' | 'stale' | 'failed';
  checkedAt: number | null;
  expiresAt: number | null;
  /** Server time at serialization, so clients need not share the server's clock. */
  asOf: number;
  players: { id: string; name: string; available: boolean }[];
};
