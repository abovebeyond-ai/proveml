import type { ThresholdDefinition, ThresholdEvaluationResult } from './types';

export const thresholds: Record<string, ThresholdDefinition>;

/** Shape of an addressable threshold name: uppercase letters, digits, underscores; starts with a letter. */
export const THRESHOLD_NAME: RegExp;

export function evaluateThreshold(
  thresholdName: string,
  actualValue: string | number | boolean | null | undefined,
  registry?: Record<string, ThresholdDefinition>
): ThresholdEvaluationResult;

export function getThresholdNames(registry?: Record<string, ThresholdDefinition>): string[];

export type { ThresholdDefinition, ThresholdEvaluationResult } from './types';
