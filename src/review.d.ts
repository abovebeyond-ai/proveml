export interface Judgement {
  verdict: 'fair' | 'flag' | string;
  at: string;
  [key: string]: unknown;
}

export interface Review {
  judgements: Record<string, Judgement>;
}

export interface ReviewSummary {
  total: number;
  judged: number;
  flagged: number;
  unjudged: string[];
  /** Judgements whose content no longer exists in this form: each one is a checkmark that would have silently lied on a hand-kept list. */
  orphaned: string[];
}

/** The identity of a judgement: a hash over exactly the parts being judged. */
export function reviewId(...parts: unknown[]): string;
export function emptyReview(): Review;
export function judge(review: Review, id: string, verdict: string | null, extra?: Record<string, unknown>): Review;
export function summarize(review: Review, presentIds: Iterable<string>): ReviewSummary;

/** Shared browser widget: include both, mark items with data-review="<reviewId>", give the bar a home in #proveml-review-bar. */
export const REVIEW_CSS: string;
export const REVIEW_JS: string;
