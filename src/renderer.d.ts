import type { FactSource, FactStore, RenderProvemlOptions, RenderProvemlResult, Renderer } from './types';

export function createRenderer(factStore: FactSource): Renderer & {
  render(source: string, options?: RenderProvemlOptions): RenderProvemlResult;
};

export type {
  FactSource,
  FactStore,
  FactStoreValue,
  RenderProvemlOptions,
  RenderProvemlResult,
  Renderer,
  TrustAdapter,
  TrustMetadata,
  TrustMetadataFields,
  TrustStatus,
} from './types';
