export const ANCHOR_KIND: 'proveml-review-anchor';
export const HCS_MESSAGE_LIMIT: 1024;
export const NETWORKS: Record<'mainnet' | 'testnet', { mirror: string; hashscan: string }>;

export type HederaNetwork = 'mainnet' | 'testnet';

/** An operator account on Hedera; the file at ~/.config/proveml/hedera-operator.json has this shape. Keep it out of the repo. */
export interface AnchorOperator {
  network?: HederaNetwork;
  accountId: string;
  /** DER hex private key from the Hedera portal (302e… for ED25519, 3030… for ECDSA). */
  privateKey: string;
  /** Without one a topic is created and returned on the record as topicId, with topicCreated: true. */
  topicId?: string;
}

export interface AnchorPayload {
  v: 1;
  kind: 'proveml-review-anchor';
  /** review root (sha256 hex) */
  review: string;
  /** output root the review folds in (sha256 hex) */
  output: string;
  /** number of sources the readings stood on */
  sources: number;
  /** sha256 of the review credential, when one was issued */
  credentialSha256?: string;
  at: string;
}

/** The record kept: what the mirror node returned, plus the payload it stands for. Feeds reviewPage({ anchors: { hedera } }). */
export interface AnchorRecord {
  network: HederaNetwork;
  topicId: string;
  sequenceNumber: number;
  consensusTimestamp: string;
  runningHash?: string;
  runningHashVersion?: number;
  payerAccountId?: string;
  transactionId?: string;
  mirror: string;
  hashscanTopic: string;
  hashscanTx?: string;
  messageSha256?: string;
  payload: AnchorPayload;
  confirmedByMirrorAt?: string;
  topicCreated?: boolean;
}

export interface AnchorCheck {
  ok: boolean;
  reason: string;
}

export interface AnchorVerification extends AnchorCheck {
  /** true only when the mirror node itself returned the same bytes at the same consensus time */
  confirmed: boolean;
  entry?: unknown;
}

type FetchLike = (input: string, init?: Record<string, unknown>) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export function anchorPayload(opts: { review: string; output: string; sources?: number; credential?: string; at?: string }): AnchorPayload;
export function anchorMessage(payload: AnchorPayload): Buffer;
export function anchorLinks(opts: { network?: HederaNetwork; topicId: string; sequenceNumber: number; transactionId?: string }): { mirror: string; hashscanTopic: string; hashscanTx?: string };
export function anchorReview(opts: { payload: AnchorPayload; operator: AnchorOperator; sdk?: unknown; fetch?: FetchLike; tries?: number; wait?: number }): Promise<AnchorRecord>;
export function checkAnchorRecord(record: AnchorRecord): AnchorCheck;
export function verifyAnchor(record: AnchorRecord, opts?: { fetch?: FetchLike }): Promise<AnchorVerification>;
export function anchorSigner(opts: { operator: AnchorOperator; outputRoot?: string; subjects?: { id: string; claim: string }[]; sources?: Record<string, string>; sdk?: unknown; fetch?: FetchLike; tries?: number; wait?: number }): (review: Record<string, unknown>) => Promise<Record<string, unknown>>;
