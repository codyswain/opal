/** One side of a variant: A is what the build shipped, B the version beside it. */
export type VariantSide = 'a' | 'b';
/** What an answer can pick. */
export type TestChoice = VariantSide | 'neither';

/** One of a test's two versions. */
export interface TestVersion {
  label: string;
  /** For a page test, the file this version is: from the folder's top as written, absolute once sent. Null for an interface test. */
  path: string | null;
}

/**
 * The day's A/B test, as an agent wrote it in `Library/tests/<date> test.json`.
 * An interface test switches a variant in the app; a page test opens one of two files.
 */
export interface DailyTest {
  id: string;
  title: string;
  question: string;
  kind: 'interface' | 'page';
  /** The variant an interface test switches; null for a page test. */
  variant: string | null;
  /**
   * Where switching an interface test takes the user: "daily", "recent" or a
   * file (from the folder's top as written, absolute once sent). Null for none.
   */
  where: string | null;
  a: TestVersion;
  b: TestVersion;
}

/** `Library/tests/<date> answer.json`, which Opal writes. */
export interface TestAnswer {
  version: 1;
  id: string;
  choice: TestChoice;
  reason: string;
  /** ISO 8601, UTC, to the second. */
  answeredAt: string;
}

/** The current test and its answer, if any. */
export interface VaultTest {
  root: string;
  /** The test's date, YYYY-MM-DD: today, or one of the two days before. */
  date: string;
  test: DailyTest;
  answer: TestAnswer | null;
}

/** Sent as `vault:test-changed` when the current test of a folder reads differently on disk. */
export interface VaultTestChange {
  root: string;
}

/** The side each variant is on, on this Mac. A variant not listed is on A. */
export type VariantSides = Record<string, VariantSide>;

/** What answering returns: the answer as written and the variant sides after it. */
export interface TestAnswerResult {
  answer: TestAnswer;
  sides: VariantSides;
}
