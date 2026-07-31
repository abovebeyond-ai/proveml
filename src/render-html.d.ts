import type {
  FactSource,
  FactStore,
  ProveMLClassNames,
  RenderProvemlOptions,
  RenderProvemlResult,
} from './types';

export function renderProveml(
  markup: string,
  factStore: FactSource,
  options?: RenderProvemlOptions
): RenderProvemlResult;

export function attachHover(container: Element | Document): void;

export const PROVEML_CLASSNAMES: Readonly<ProveMLClassNames>;
export const PROVEML_CSS: string;

export type {
  FactStore,
  FactStoreValue,
  ProveMLClassNames,
  RenderProvemlOptions,
  RenderProvemlResult,
  TrustAdapter,
  TrustMetadata,
  TrustMetadataFields,
  TrustStatus,
  VerificationDetail,
  VerificationResult,
} from './types';
