import type { ThresholdDefinition, ThresholdEvaluationResult } from './types';

export const thresholds: Record<string, ThresholdDefinition>;

export function evaluateThreshold(
  thresholdName: string,
  actualValue: string | number | boolean | null | undefined
): ThresholdEvaluationResult;

export function getThresholdNames(): string[];

export type { ThresholdDefinition, ThresholdEvaluationResult } from './types';
