import type { FactStore, ThresholdDefinition } from './types';

export interface PromptOptions {
  store?: FactStore;
  thresholds?: Record<string, ThresholdDefinition>;
  role?: string;
  example?: string;
  data?: boolean;
}

/** The system prompt a model needs to write ProveML that verifies, generated from the store and the registry. */
export function promptFor(options?: PromptOptions): string;

export const PROMPT_RULES: readonly string[];
