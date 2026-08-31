export type EvidenceBasis = 'quote' | 'derived' | 'absence';

export interface EvidenceEntry {
  /** Store field this evidence supports (the part after the entity prefix). */
  field: string;
  /** The store value the evidence is claimed to support. */
  claimValue: unknown;
  basis: EvidenceBasis;
  /** Required when basis is 'quote'; checked verbatim against the subject's snapshot when one is given. */
  sourceQuote?: string;
  /** Where in the source the quote sits, for a reader retracing it. */
  sourceLocator?: string;
  /** Link to the archived source. */
  sourceHref?: string;
  note?: string;
}

export interface ReviewSubject {
  id: string;
  title: string;
  /** Prose lead for the card's meta line, e.g. "Authors, 2023. In the store as citation:x:". */
  meta?: string;
  /** ProveML markup for the left column; verified against the store, the build throws on any error. */
  claim: string;
  evidence: EvidenceEntry[];
}

export interface ReviewPageOptions {
  store: Record<string, unknown>;
  subjects: ReviewSubject[];
  /** Tool label in the lockup. Default 'review'. */
  name?: string;
  /** Shown in the statline. Default 'store'. */
  storeName?: string;
  /** Noun for the statline count. Default 'subjects'. */
  subjectsWord?: string;
  /** Column labels. Default 'the output' and 'the evidence'. */
  leftLabel?: string;
  rightLabel?: string;
  /** Plain text per subject id; when present, every quote of that subject must occur in it verbatim or the build throws. */
  snapshots?: Record<string, string>;
  /** A review JSON ({judgements}) baked into the page; local judgements overlay it and the export merges both. */
  committedReview?: { judgements: Record<string, unknown> } | null;
  /** Threshold registry passed to the verifier. */
  thresholds?: Record<string, unknown>;
}

export interface ReviewPageResult {
  html: string;
  verified: number;
  total: number;
  /** The review ids of every reading on the page, for summarize() against a committed review. */
  ids: string[];
}

/** The identity of one reading: reviewId over subject id, field, value, basis, quote, note. */
export function evidenceReviewId(subjectId: string, e: EvidenceEntry): string;

/** Build the review page. Throws if any claim fails verification or any quote is not verbatim in its snapshot. */
export function reviewPage(opts: ReviewPageOptions): ReviewPageResult;

/** Plain text from an archived snapshot, for the verbatim gate: tags stripped, common entities decoded, whitespace squashed. */
export function snapshotText(raw: string, opts?: { html?: boolean }): string;
