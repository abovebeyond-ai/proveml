import type { ProveMLOptions } from './types';

declare function provemlPlugin(md: any, options?: ProveMLOptions): void;

export default provemlPlugin;
export type {
  FactSource,
  FactStore,
  FactStoreValue,
  ProveMLOptions,
  TrustAdapter,
  TrustMetadata,
  TrustMetadataFields,
  TrustStatus,
  VerificationDetail,
  VerificationResult
} from './types';
