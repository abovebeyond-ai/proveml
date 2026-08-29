import type {
  FactSource,
  ProveMLToken,
  UnmarkedNumber,
  VerificationResult,
  VerifyProvemlOptions,
} from './types';

export function verifyProveml(
  markdown: string,
  factStore: FactSource,
  options?: VerifyProvemlOptions
): VerificationResult;

export function stripProveml(markdown: string): string;

export function unmarkedNumbers(markdown: string): UnmarkedNumber[];

export function tokenizeProveml(src: string, baseOffset?: number, skipped?: { pos: number; end: number }[]): ProveMLToken[];

export type {
  EntityToken,
  EntityVerificationDetail,
  FactSource,
  FactStore,
  FactStoreValue,
  FactToken,
  FactVerificationDetail,
  InferenceToken,
  InferenceVerificationDetail,
  ProveMLToken,
  TrustAdapter,
  TrustMetadata,
  TrustMetadataFields,
  TrustStatus,
  UnmarkedNumber,
  UnmarkedNumberDetail,
  Coverage,
  VerificationDetail,
  VerificationResult,
  VerifyProvemlOptions,
} from './types';
