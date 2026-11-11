import type { DailyTest, TestAnswer, TestChoice, TestVersion } from '@/types/dailyTest';
import { isVariantName } from './variants';

/** Where a vault keeps its daily tests, from its top. */
export const TESTS_FOLDER = 'Library/tests';
export const testName = (date: string) => `${date} test.json`;
export const answerName = (date: string) => `${date} answer.json`;
/** How many days a test stays current unanswered: today and the two before. */
export const TEST_DAYS = 3;
/** The longest reason an answer keeps. */
export const REASON_LIMIT = 1000;

/** The dates whose tests can be current, today first. `today` is YYYY-MM-DD. */
export function testDates(today: string): string[] {
  return Array.from({ length: TEST_DAYS }, (_, back) => {
    const date = new Date(`${today}T12:00:00`);
    date.setDate(date.getDate() - back);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  });
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value);

/** One line of text, not empty, at most `limit` characters. */
const line = (value: unknown, limit: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= limit && !/[\r\n\0]/.test(value);

/** A file's path from the folder's top, with forward slashes, that stays inside it. */
export function isRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 1024) return false;
  if (value.startsWith('/') || value.includes('\\') || value.includes('\0')) return false;
  return value.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

const isChoice = (value: unknown): value is TestChoice => value === 'a' || value === 'b' || value === 'neither';

/**
 * A test file's contents, or null when anything about it is malformed:
 * a page test names two files and nothing else, an interface test a variant
 * and optionally where it shows. Paths stay as written, from the folder's top.
 */
export function parseDailyTest(json: unknown): DailyTest | null {
  if (!isObject(json) || json.version !== 1) return null;
  const { id, title, question, kind, a, b } = json;
  if (!line(id, 100) || !line(title, 200) || !line(question, 500)) return null;
  if (!isObject(a) || !isObject(b) || !line(a.label, 40) || !line(b.label, 40)) return null;
  const version = (side: Json, path: string | null): TestVersion => ({ label: (side.label as string).trim(), path });
  const base = { id: id.trim(), title: title.trim(), question: question.trim() };
  if (kind === 'interface') {
    const { variant, where } = json;
    if (!isVariantName(variant) || 'path' in a || 'path' in b) return null;
    if (where !== undefined && !isRelativePath(where)) return null;
    return { ...base, kind, variant, where: isRelativePath(where) ? where : null, a: version(a, null), b: version(b, null) };
  }
  if (kind === 'page') {
    if ('variant' in json || 'where' in json) return null;
    if (!isRelativePath(a.path) || !isRelativePath(b.path) || a.path === b.path) return null;
    return { ...base, kind, variant: null, where: null, a: version(a, a.path), b: version(b, b.path) };
  }
  return null;
}

/** An answer file's contents, or null when malformed. */
export function parseTestAnswer(json: unknown): TestAnswer | null {
  if (!isObject(json) || json.version !== 1) return null;
  const { id, choice, reason, answeredAt } = json;
  if (!line(id, 100) || !isChoice(choice)) return null;
  if (typeof reason !== 'string' || reason.length > REASON_LIMIT || /[\r\n\0]/.test(reason)) return null;
  if (typeof answeredAt !== 'string' || Number.isNaN(Date.parse(answeredAt))) return null;
  return { version: 1, id: id.trim(), choice, reason, answeredAt };
}

/** The reason as an answer keeps it: one line, trimmed, at most the limit. */
export function cleanReason(reason: string): string {
  return reason.replace(/[\r\n\0]+/g, ' ').trim().slice(0, REASON_LIMIT);
}

/** What one date holds: its test, and an answer to that test. */
export interface TestDay<T extends { id: string } = DailyTest> {
  date: string;
  test: T | null;
  answer: TestAnswer | null;
}

/**
 * Which test the sidebar shows, from today and the two days before, newest
 * first: the newest test with no answer to it; else, when every one is
 * answered, today's test as answered; else none. An answer counts only for
 * the test whose id it names.
 */
export function currentTest<T extends { id: string }>(today: string, days: readonly TestDay<T>[]): TestDay<T> & { test: T } | null {
  const answered = (day: TestDay<T>) => day.answer !== null && day.answer.id === day.test?.id;
  const tests = days
    .filter((day): day is TestDay<T> & { test: T } => day.test !== null)
    .sort((left, right) => (left.date < right.date ? 1 : -1));
  const open = tests.find((day) => !answered(day));
  if (open) return { ...open, answer: null };
  return tests.find((day) => day.date === today) ?? null;
}
