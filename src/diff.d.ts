export interface DiffClaim {
  key: string;
  type: 'entity' | 'fact' | 'inference';
  path?: string;
  name?: string;
  label?: string;
  value?: unknown;
  count: number;
}

export interface TurnDiff {
  /** Claims that existed last turn and are gone: the silent-skip catcher; a rebound fact appears as one removed plus one added at another path. */
  removed: DiffClaim[];
  added: DiffClaim[];
  prev: { verified: number; total: number; unmarked: number };
  next: { verified: number; total: number; unmarked: number };
  /** Prose blocks changed between turns, by the manifest contract over the stripped text. */
  leaves: { prevCount: number; nextCount: number; changed: number; changedTexts: string[] };
  /** True when nothing was removed, verification did not regress, and no new unmarked numbers appeared. */
  clean: boolean;
}

/** Compare two turns of a document against the same store. Options are passed to verifyProveml. */
export function diffTurns(prevMarkup: string, nextMarkup: string, factStore: Record<string, unknown>, options?: Record<string, unknown>): TurnDiff;

/** One line for the loop's log. */
export function formatTurnDiff(d: TurnDiff): string;
