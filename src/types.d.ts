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
   * Treat every number in the prose that no construct covers as a finding
   * (status 'unmarked'). Without it, coverage is reported but not judged.
   */
  strict?: boolean;
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

/** Every detail carries the source span of its construct (character offsets). */
export interface VerificationSpan {
  pos: number;
  end: number;
}

export interface EntityVerificationDetail extends TrustMetadataFields, VerificationSpan {
  type: 'entity';
  path: string;
  name: string;
  status: 'verified' | 'entity-not-found' | 'name-mismatch';
  expected?: FactStoreValue;
  errorClass?: 'reference';
}

export interface FactVerificationDetail extends TrustMetadataFields, VerificationSpan {
  type: 'fact';
  path?: string;
  /** Only present when status is 'no-context' (there is no path without an entity). */
  field?: string;
  value: string;
  status: 'verified' | 'field-not-found' | 'value-mismatch' | 'no-context';
  expected?: string;
  errorClass?: 'reference' | 'value' | 'context';
}

export interface InferenceVerificationDetail extends TrustMetadataFields, VerificationSpan {
  type: 'inference';
  label: string;
  /**
   * 'failed' = the condition resolved to false; 'unverifiable' = it could not
   * be resolved (unknown threshold, missing operand, undefined label). The
   * two are distinct on purpose: NOT of an unresolvable condition stays
   * unresolvable.
   */
  status: 'verified' | 'failed' | 'unverifiable';
  unknown?: true;
  error?: string;
}

/** A number in the prose outside every construct; only present with `strict`. */
export interface UnmarkedNumberDetail extends VerificationSpan {
  type: 'unmarked';
  value: string;
  status: 'unmarked';
  errorClass: 'coverage';
}

export type VerificationDetail =
  | EntityVerificationDetail
  | FactVerificationDetail
  | InferenceVerificationDetail
  | UnmarkedNumberDetail;

export interface UnmarkedNumber extends VerificationSpan {
  value: string;
}

export interface Coverage {
  /** fact constructs whose value contains a digit */
  marked: number;
  /** standalone numbers in the prose outside every construct */
  unmarked: number;
  /** marked / (marked + unmarked); null when there are no numbers at all */
  rate: number | null;
}

export interface VerificationResult {
  /** claims inside markup (entities, facts, inferences) */
  total: number;
  verified: number;
  errors: string[];
  details: VerificationDetail[];
  snapshot?: string;
  unmarked: UnmarkedNumber[];
  coverage: Coverage;
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
