import type { Review } from './review.js';

export const REVIEW_VCT: 'urn:proveml:review:1';
export const REVIEW_TYP: 'proveml-review+jwt';

export interface Jwk { kty: string; crv: string; x: string; d?: string; [key: string]: unknown }

/** The output root the page folds in as the first leaf: one line per subject, id and claim. */
export function outputRootOf(subjects: Array<{ id: string; claim: string }>): string;
/** The review root: output root first, then every judgement in key order. Same recipe as the page. */
export function reviewRoot(judgements: Review['judgements'], outputRoot: string): string;
/** A fresh Ed25519 reviewer key pair as JWKs. */
export function generateReviewerKey(): { privateJwk: Jwk; publicJwk: Jwk; kid: string };
/** RFC 7638 thumbprint of an OKP public key. */
export function thumbprint(publicJwk: Jwk): string;

export interface IssueOptions {
  review: Review & { signedBy?: string; exported?: string };
  outputRoot: string;
  sources?: Record<string, string>;
  issuer: string;
  privateJwk: Jwk;
  keyId?: string;
}
/** Sign a review: a compact JWS (EdDSA) whose payload carries the judgements, the roots and the review root. */
export function issueReviewCredential(opts: IssueOptions): { credential: string; root: string; kid: string };

export interface ReviewCredentialPayload {
  vct: string; iss: string; iat: number;
  root: string; output: string; sources: Record<string, string>;
  judged: number; flagged: number; signedBy?: string; exported?: string;
  judgements: Review['judgements'];
}
export function decodeReviewCredential(credential: string): { header: { alg: string; typ: string; kid?: string }; payload: ReviewCredentialPayload; signingInput: string; signature: Buffer };

export interface VerifyResult {
  ok: boolean;
  reason?: string;
  payload?: ReviewCredentialPayload;
  root?: string;
  issuer?: string;
  kid?: string;
}
/** Recompute the review root from the payload, then check the signature against the given public key. */
export function verifyReviewCredential(credential: string, opts?: { publicJwk?: Jwk }): VerifyResult;

/** A signer for awaitReview: returns the review with `credential`, `credentialRoot`, `credentialKid` and `outputRoot` added. */
export function credentialSigner(opts: { issuer: string; privateJwk: Jwk; keyId?: string; outputRoot?: string; subjects?: Array<{ id: string; claim: string }>; sources?: Record<string, string> }): (review: Review) => Promise<Review & { credential: string; credentialRoot: string; credentialKid: string; outputRoot: string }>;
