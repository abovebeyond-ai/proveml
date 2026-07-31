import type { FactStore, FactStoreValue, TrustMetadata, TrustMetadataFields } from './types';

export interface ResolveResult {
  found: boolean;
  value?: FactStoreValue;
  unit?: FactStoreValue;
  trust?: TrustMetadata;
}

export interface TrustAdapter {
  resolve(path: string): ResolveResult;
}

export function plainAdapter(factStore?: FactStore): TrustAdapter;
export function toTrustAdapter(input?: FactStore | TrustAdapter): TrustAdapter;
export function getTrustFields(resolution?: ResolveResult): TrustMetadataFields;
export function getExpectedSurfaceValue(resolution?: ResolveResult): string | undefined;

export type { FactStore, FactStoreValue, TrustMetadata, TrustMetadataFields } from './types';
