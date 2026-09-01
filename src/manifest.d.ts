export const CANONICALIZATION: 'proveml-c14n-1';
export const SEGMENTATION: 'block-1';
export const MANIFEST_VERSION: 1;

export interface ManifestLeaf {
  i: number;
  text: string;
  hash: string;
}

export interface Manifest {
  v: 1;
  canonicalization: string;
  segmentation: string;
  source?: string;
  capturedAt?: string;
  leaves: ManifestLeaf[];
  root: string;
}

export interface InclusionProof {
  index: number;
  leafHash: string;
  path: { side: 'L' | 'R'; hash: string }[];
}

export interface QuoteEvidence {
  quote: string;
  leafIndex: number;
  leafHash: string;
  offset: number;
  root: string;
  proof: InclusionProof;
}

export function leafHash(text: string): string;
/** The canonical leaves of a document, per c14n-1 + block-1. */
export function canonicalSegments(raw: string, opts?: { html?: boolean }): string[];
/** Build a manifest; source and capturedAt travel as provenance and are not hashed into the tree. */
export function buildManifest(raw: string, opts?: { html?: boolean; source?: string; capturedAt?: string }): Manifest;
/** Sibling hashes from leaf to root. Throws on an unknown contract or missing leaf. */
export function inclusionProof(manifest: Manifest, index: number): InclusionProof;
/** Recompute the root from a leaf text and a proof; true iff it matches. */
export function verifyInclusion(root: string, leafText: string, proof: InclusionProof): boolean;
/** Whitespace-insensitive containment within a single leaf; a quote spanning leaves returns null. */
export function findQuote(manifest: Manifest, quote: string): { index: number; leaf: ManifestLeaf; offset: number } | null;
/** The evidence-ready bundle for a quote; throws when the quote is not verbatim within a single leaf. */
export function quoteEvidence(manifest: Manifest, quote: string): QuoteEvidence;
