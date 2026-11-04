/** A frozen Top 3 item. Comparison checkboxes are display-only. */
export interface DigestReviewItem {
  title: string;
  detail: string;
  checked: boolean;
}

export type DigestReviewChoice = 'A' | 'B' | 'tie' | 'neither';

export interface DigestReviewVote {
  choice: DigestReviewChoice;
  reason: string;
  chosenAt: string;
  blind: boolean;
}

/** Public view: origin labels are withheld until a vote or explicit reveal. */
export interface DigestReview {
  id: string;
  date: string;
  createdAt: string;
  status: 'generating' | 'ready' | 'failed' | 'skipped';
  budgetUsd: number;
  variants?: { A: { items: DigestReviewItem[] }; B: { items: DigestReviewItem[] } };
  labels?: { A: string; B: string };
  vote?: DigestReviewVote;
  revealed: boolean;
  costUsd?: number;
}

/** Written once per day by the Mini worker, separate from Cody's vote. */
export interface DigestReviewRecord {
  schemaVersion: 1;
  id: string;
  date: string;
  createdAt: string;
  status: DigestReview['status'];
  budgetUsd: number;
  source: { digestPath: string; sha256: string; section: 'Top 3' };
  variants?: {
    A: { kind: 'current' | 'concise'; items: DigestReviewItem[] };
    B: { kind: 'current' | 'concise'; items: DigestReviewItem[] };
  };
  generation: {
    model: string;
    reservedUsd: number;
    maxOutputTokens: number;
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
    error?: string;
  };
}

export interface DigestReviewVoteRecord {
  schemaVersion: 1;
  date: string;
  reviewId: string;
  firstVote?: DigestReviewVote;
  vote?: DigestReviewVote;
  revealedAt?: string;
}
