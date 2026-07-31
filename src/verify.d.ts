import type {
  FactSource,
  ProveMLToken,
  VerificationResult,
  VerifyProvemlOptions,
} from './types';

export function verifyProveml(
  markdown: string,
  factStore: FactSource,
  options?: VerifyProvemlOptions
): VerificationResult;

export function stripProveml(markdown: string): string;

export function tokenizeProveml(src: string, baseOffset?: number): ProveMLToken[];

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
  VerificationDetail,
  VerificationResult,
  VerifyProvemlOptions,
} from './types';
