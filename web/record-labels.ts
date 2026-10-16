/** Short, room-friendly sticker copy. Never selected from song metadata or audio. */
export const recordLabels = [
  'TRUST THE SPIN',
  'TOP SECRET GROOVE',
  'ALIBI IN STEREO',
  'CLASSIFIED VIBES',
  'NO SPOILERS',
  'STEALTH PRESSING',
  'EVIDENCE ON WAX',
  'MYSTERY EDITION',
  'UNDERCOVER BOP',
  'SECRET SAUCE',

  'LICENSE TO CHILL',
  'VIBE WITNESS',
  'CLUES SOLD OUT',
  'PLAUSIBLE DENIABILITY',
  'NEEDLE KNOWS',
  'GROOVE IN DISGUISE',
  'REDACTED RECORD',
  'SEALED FOR FRESHNESS',
  'SUSPICIOUSLY GOOD',
  'WITNESS THE FITNESS',

  'CERTIFIED EARWORM',
  'CAUTION: TASTE',
  'FRESHLY OVERTHOUGHT',
  'SMALL BATCH VIBES',
  'ARTISANAL NOISE',
  'ETHICALLY SOURCED BOP',
  'FREE RANGE GROOVE',
  'LOCALLY GROWN TASTE',
  'MAY CONTAIN FEELINGS',
  'SERVE AT ROOM VOLUME',

  'SINGLE ORIGIN VIBES',
  'NO ADDED SPOILERS',
  'PAIRS WITH NODDING',
  'FULL BODIED GROOVE',
  'BEST BEFORE REVEAL',
  'GOURMET GUESSWORK',
  'CHEF SAYS LISTEN',
  'TASTE TEST INCOMING',
  'AUDIO SOUP DU JOUR',
  'SECRET MENU ITEM',

  'SPIN DOCTOR',
  'GROOVE CONSULTANT',
  'CHIEF VIBE OFFICER',
  'HEAD OF SUSPENSE',
  'DIRECTOR OF NODS',
  'DEPARTMENT OF BOPS',
  'MINISTER OF MYSTERY',
  'ACTING COOL DEPT.',
  'OFFICIAL TASTE TESTER',
  'SENIOR NEEDLE ADVISOR',

  'VIBES: APPROVED',
  'MEETING COULD BE A BOP',
  'OUT OF OFFICE MIX',
  'GROOVE ON THE CLOCK',
  'PAPERWORK PENDING',
  'NO SLIDES, JUST SIDES',
  'PLEASE HOLD THE GUESS',
  'PER MY LAST RECORD',
  'SYNERGY IN STEREO',
  'ANNUAL GROOVE REVIEW',

  'SCIENCE SAYS MAYBE',
  'PEER REVIEWED VIBES',
  'EXPERIMENTAL NODDING',
  'HYPOTHESIS: A BOP',
  'CONTROLLED GROOVE',
  'SAMPLE SIZE: ONE SONG',
  'DOUBLE BLIND LISTEN',
  'RESULTS SOUND GOOD',
  'LAB COAT OPTIONAL',
  'PENDING VIBE ANALYSIS',

  'THE PLOT THICKENS',
  'UNEXPECTED PLOT TWIST',
  'SUSPENSE ON REPEAT',
  'THE NEEDLE DID IT',
  'GROOVE WITH A VIEW',
  'COMING SOON: CONTEXT',
  'A VERY QUIET HEIST',
  'SOUNDTRACK TO A SHRUG',
  'THE USUAL GUESSWORK',
  'ROLL THE CREDITS LATER',

  'PASSPORT TO A BOP',
  'DETOUR VIA GROOVE',
  'DESTINATION: UNKNOWN',
  'ALL ABOARD THE VIBE',
  'CARRY ON GROOVING',
  'SCENIC ROUTE TO TASTE',
  'NO MAP, JUST MUSIC',
  'POSTCARD FROM A BOP',
  'NEXT STOP: REVEAL',
  'EXCESS VIBE BAGGAGE',

  'PREMIUM GUESSWORK',
  'DELUXE POKER FACE',
  'LIMITED EDITION NOD',
  'COLLECTIBLE CONFUSION',
  'FIRST PRESS SECRETS',
  'BONUS TRACK: MYSTERY',
  'SPOILER FREE MASTER',
  'MINT CONDITION VIBES',
  'RARE GROOVE SIGHTING',
  'AUTHENTIC HEAD TILT',

  'HANDLE WITH EAR',
  'FRAGILE: GOOD TASTE',
  'THIS SIDE UPBEAT',
  'DO NOT FEED THE GUESS',
  'KEEP EARS UPRIGHT',
  'VIBES UNDER PRESSURE',
  'OPEN WITH YOUR EARS',
  'NO ASSEMBLY REQUIRED',
  'BATTERIES NOT NEEDED',
  'CONTENTS: A DECISION',

  'NOD NOW, ASK LATER',
  'TRUST FALL IN STEREO',
  'LET THE NEEDLE COOK',
  'DON’T GUESS AT ME',
  'LESS TALK, MORE WAX',
  'PLEASE NOD RESPONSIBLY',
  'EARS NOW, OPINIONS LATER',
  'KEEP CALM AND GUESS',
  'NO HINTS WERE HARMED',
  'THINK INSIDE THE GROOVE',

  'EARWORM INCUBATOR',
  'SPOILER REPELLENT',
  'CURIOSITY FUEL',
  'NODDING MATERIAL',
  'EMERGENCY VIBE KIT',
  'POCKET SIZED DRAMA',
  'CONCENTRATED GROOVE',
  'HEADPHONE BAIT',
  'AUDIO COMFORT FOOD',
  'FRESH GUESS DELIVERY',

  'PROOF OF GOOD TASTE?',
  'CONFIDENCE: LOUD',
  'EXPLANATION PENDING',
  'REASONS TO FOLLOW',
  'THE DEFENCE RESTS',
  'GUILTY OF GROOVING',
  'NO COMMENT, JUST NODS',
  'ASK MY GROOVE LAWYER',
  'EXHIBIT A: A BOP',
  'VERDICT AFTER REVEAL',

  'SPIN NOW, BRAG LATER',
  'HUMBLE BOP ENERGY',
  'MODESTLY ICONIC',
  'CASUALLY CURATED',
  'AGGRESSIVELY TASTEFUL',
  'COOL BY ACCIDENT',
  'ACCIDENTALLY ON BRAND',
  'EFFORTLESSLY SUSPECT',
  'PROBABLY MEANT THIS',
  'SUBTLETY SOLD SEPARATELY',

  'WAX ON, CLUES OFF',
  'SPINNING A GOOD YARN',
  'GROOVY LITTLE SECRET',
  'A TURN FOR THE BETTER',
  'OFF THE RECORD, ON WAX',
  'IN A COMMITTED GROOVE',
  'NEEDLE LITTLE PATIENCE',
  'ROUND AND MYSTERIOUS',
  'ROUND FOR A REASON',
  'WAXING LYRICAL LATER',

  'HIGH FIDELITY POKER FACE',
  'LOW KEY MAIN CHARACTER',
  'PEAK LIVING ROOM ENERGY',
  'SOFA TOUR HEADLINER',
  'FRONT ROW: EVERYONE',
  'STADIUM TASTE, SOFA SEAT',
  'SOLD OUT TO THIS ROOM',
  'INTIMATE VENUE, BIG NOD',
  'TONIGHT’S MYSTERY GUEST',
  'THE LOUNGE HAS SPOKEN',

  'ONE SONG, MANY THEORIES',
  'GUESSING IS CARDIO',
  'KEEP THAT GUESS WARM',
  'CONFIDENTLY INCORRECT?',
  'NICE THEORY, KEEP GOING',
  'YOUR GUESS NEEDS A NAP',
  'HINTS ON ANNUAL LEAVE',
  'CLUES LEFT THE CHAT',
  'SUSPENSE, BUT COZY',
  'ANSWERS AFTER THE VIBE',
] as const;

export const recordLabelStorageKey = 'aoty.public-record-labels.v1';
type LabelStorage = Pick<Storage, 'getItem' | 'setItem'>;
type DeckState = {
  version: 1; size: number; remaining: number[];
  current: { identity: string; index: number } | null;
};
function browserStorage(): LabelStorage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage; } catch { return undefined; }
}
function validIndex(index: unknown): index is number { return Number.isInteger(index) && Number(index) >= 0 && Number(index) < recordLabels.length; }

/** A bounded shuffle bag: a new sticker per playback, no repeated phrase until the entire bag is used. */
export class RecordLabelDeck {
  private state: DeckState = { version: 1, size: recordLabels.length, remaining: [], current: null };
  private storageHealthy = true;
  constructor(private storage = browserStorage(), private random = Math.random) { this.state = this.load() ?? this.state; }
  private load(): DeckState | undefined {
    if (!this.storageHealthy) return;
    try {
      const raw = this.storage?.getItem(recordLabelStorageKey); if (!raw || raw.length > 16_384) return;
      const data = JSON.parse(raw) as DeckState;
      if (data.version !== 1 || data.size !== recordLabels.length || !Array.isArray(data.remaining) || data.remaining.length > recordLabels.length ||
        !data.remaining.every(validIndex) || new Set(data.remaining).size !== data.remaining.length) return;
      if (data.current !== null && (!data.current || typeof data.current.identity !== 'string' || data.current.identity.length > 2000 ||
        !validIndex(data.current.index) || data.remaining.includes(data.current.index))) return;
      return data;
    } catch { this.storageHealthy = false; return; } // Restricted storage must never break or rewind the in-memory bag.
  }
  label(identity: string, nickname?: string) {
    if (this.state.current?.identity !== identity) {
      this.state = this.load() ?? this.state;
      if (this.state.current?.identity !== identity) {
        if (!this.state.remaining.length) {
          const previous = this.state.current?.index;
          this.state.remaining = recordLabels.map((_, index) => index);
          for (let i = this.state.remaining.length - 1; i > 0; i--) {
            const j = Math.floor(this.random() * (i + 1));
            [this.state.remaining[i], this.state.remaining[j]] = [this.state.remaining[j]!, this.state.remaining[i]!];
          }
          // Even after exhaustion, never repeat the immediately preceding sticker.
          const last = this.state.remaining.length - 1;
          if (this.state.remaining[last] === previous) [this.state.remaining[0], this.state.remaining[last]] = [this.state.remaining[last]!, this.state.remaining[0]!];
        }
        this.state.current = { identity, index: this.state.remaining.pop()! };
        try { if (this.storageHealthy) this.storage?.setItem(recordLabelStorageKey, JSON.stringify(this.state)); }
        catch { this.storageHealthy = false; } // Do not reload older storage after a failed write.
      }
    }
    return { owner: nickname || 'Mystery DJ', caption: recordLabels[this.state.current!.index]! };
  }
}

// Survives room remounts even when browser storage is blocked. No credentials or music metadata are stored.
export const publicRecordLabels = new RecordLabelDeck();
