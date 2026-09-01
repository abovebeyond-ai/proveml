import type { ReviewPageOptions } from './review-page.js';
import type { Review, ReviewSummary } from './review.js';

/**
 * Attestation adapter: receives the posted review, returns what to keep.
 * Free to add whatever its deployment calls a signature — a name, a key
 * signature, a verifiable credential, a ledger anchor. Must not judge:
 * signers attest to a review, they never change verdicts.
 */
export type ReviewSigner = (review: Review & Record<string, unknown>) => object | Promise<object>;

export interface AwaitReviewOptions extends ReviewPageOptions {
  signer?: ReviewSigner;
  /** Recorded on the review before the signer runs. */
  signedBy?: string;
  /** Open the page in the default browser. Default true. */
  open?: boolean;
  /** 0 picks a free port. Default 0. */
  port?: number;
  /** Url prefix to directory map; GETs under a prefix serve files from its directory, so the page's archived-source links resolve while the gate is up. */
  assets?: Record<string, string>;
  onServe?: (url: string) => void;
}

export interface AwaitReviewResult {
  review: Review & Record<string, unknown>;
  /** The page's readings counted against the signed review: unjudged and orphaned stay visible to the caller. */
  summary: ReviewSummary;
  url: string;
}

/** Build the page, serve it once, wait for the human to sign. */
export function awaitReview(opts: AwaitReviewOptions): Promise<AwaitReviewResult>;
