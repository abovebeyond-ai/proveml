import type { ThresholdDefinition, ThresholdEvaluationResult } from './types';

export const thresholds: Record<string, ThresholdDefinition>;

export function evaluateThreshold(
  thresholdName: string,
  actualValue: string | number | boolean | null | undefined,
  registry?: Record<string, ThresholdDefinition>
): ThresholdEvaluationResult;

export function getThresholdNames(registry?: Record<string, ThresholdDefinition>): string[];

export type { ThresholdDefinition, ThresholdEvaluationResult } from './types';
