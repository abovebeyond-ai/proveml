export type FactStoreValue = string | number | boolean | null | undefined;

export interface FactStore {
  [path: string]: FactStoreValue;
}

export type TrustStatus = 'verified' | 'unverified' | 'expired' | 'revoked' | 'error';

export interface TrustMetadata {
  status: TrustStatus;
  backend: string;
  proofRef?: string;
  issuer?: string;
  checkedAt?: string;
}

export interface TrustMetadataFields {
  trustStatus?: TrustStatus;
  trustBackend?: string;
  trustProofRef?: string;
  trustIssuer?: string;
  trustCheckedAt?: string;
}

export interface TrustAdapter {
  resolve(path: string): {
    found: boolean;
    value?: FactStoreValue;
    unit?: FactStoreValue;
    trust?: TrustMetadata;
  };
}

export type FactSource = FactStore | TrustAdapter;

export interface VerifyProvemlOptions {
  snapshot?: string;
  /**
   * The threshold registry for this verification. When given it REPLACES the
   * built-in example registry: a domain defines its own vocabulary, and names
   * outside it are unknown. Spread the built-in in to merge instead.
   */
  thresholds?: Record<string, ThresholdDefinition>;
}

export interface ProveMLOptions {
  factStore?: FactSource;
  /** Same contract as VerifyProvemlOptions.thresholds, for the renderer. */
  thresholds?: Record<string, ThresholdDefinition>;
}

export interface EntityVerificationDetail extends TrustMetadataFields {
  type: 'entity';
  path: string;
  name: string;
  status: 'verified' | 'entity-not-found' | 'name-mismatch';
  expected?: string;
  errorClass?: 'reference';
}

export interface FactVerificationDetail extends TrustMetadataFields {
  type: 'fact';
  path?: string;
  field?: string;
  value: string;
  status: 'verified' | 'field-not-found' | 'value-mismatch' | 'no-context';
  expected?: string;
  errorClass?: 'reference' | 'value' | 'context';
}

export interface InferenceVerificationDetail extends TrustMetadataFields {
  type: 'inference';
  label: string;
  status: 'verified' | 'failed';
  error?: string;
}

export type VerificationDetail =
  | EntityVerificationDetail
  | FactVerificationDetail
  | InferenceVerificationDetail;

export interface VerificationResult {
  total: number;
  verified: number;
  errors: string[];
  details: VerificationDetail[];
  snapshot?: string;
}

export interface EntityToken {
  type: 'entity';
  entityType: string;
  entityId: string;
  name: string;
  scoped: boolean;
  pos: number;
  end: number;
  content: string;
}

export interface EntityCloseToken {
  type: 'entity_close';
  pos: number;
  end: number;
}

export interface FactToken {
  type: 'fact';
  field: string;
  value: string;
  pos: number;
  end: number;
}

export interface InferenceToken {
  type: 'inference';
  label: string;
  condition: string;
  text: string;
  pos: number;
  end: number;
}

export type ProveMLToken =
  | EntityToken
  | EntityCloseToken
  | FactToken
  | InferenceToken;

export interface RenderProvemlOptions extends VerifyProvemlOptions {
  showProofPaths?: boolean;
}

export interface RenderProvemlResult {
  html: string;
  verification: VerificationResult;
}

export interface ProveMLClassNames {
  root: string;
  paragraph: string;
  entity: string;
  fact: string;
  inference: string;
  proof: string;
  verified: string;
  mismatch: string;
  failed: string;
  unverifiable: string;
  noContext: string;
  nameMismatch: string;
  entityHighlight: string;
  trustVerified: string;
  trustUnverified: string;
  trustExpired: string;
  trustRevoked: string;
  trustError: string;
}

export interface ThresholdDefinition {
  field: string;
  op: string;
  value?: FactStoreValue;
  low?: number;
  high?: number;
  values?: string[];
  unit?: string;
  label?: string;
  source?: string;
}

export interface ThresholdEvaluationResult {
  valid: boolean;
  result?: boolean;
  error?: string;
  threshold?: ThresholdDefinition;
  actualValue?: FactStoreValue;
  explanation?: string;
  label?: string;
  source?: string;
}

export interface Renderer {
  render(source: string, options?: RenderProvemlOptions): RenderProvemlResult;
}
