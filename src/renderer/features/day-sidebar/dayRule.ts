import { validDate } from '@/common/vaultModel';

/*
 * Which day the right sidebar shows. A dated page (a daily page, a log, a
 * recording, a recording's transcript or a digest) sets the day. Any other
 * page keeps the last day shown. With nothing set, the sidebar shows today.
 */

/**
 * The folders whose files are named by date. Until the cleanup commit the
 * Inbox folders count too, so a machine that has not moved yet still works.
 */
const DATED_PAGE =
  /(?:^|\/)(?:Library\/(?:daily|logs|recordings(?:\/transcripts)?|digests)|Inbox\/(?:Logs|Recordings|Digests))\/(\d{4}-\d{2}-\d{2})(?: [^/]*)?\.md$/;

/** The date a dated page belongs to, or null for any other page. */
export function pageDate(path: string | null): string | null {
  const match = path ? DATED_PAGE.exec(path) : null;
  return match && validDate(match[1]) ? match[1] : null;
}

/** The pages Daily opens: daily pages, and old Inbox/Logs pages until the cleanup commit. */
const DAILY_PAGE = /(?:^|\/)(?:Library\/daily|Inbox\/Logs)\/(\d{4}-\d{2}-\d{2})\.md$/;

/** The date of a daily page, or null for any other page. */
export function dailyPageDate(path: string | null): string | null {
  const match = path ? DAILY_PAGE.exec(path) : null;
  return match && validDate(match[1]) ? match[1] : null;
}

export interface DayRuleState {
  /** A day picked with the arrows or Go to today, until another page opens. */
  pickedDay: string | null;
  /** The last day shown, kept while an undated page is open. */
  lastDay: string | null;
}

export function shownDay(state: DayRuleState, openedPath: string | null, today: string): string {
  return state.pickedDay ?? pageDate(openedPath) ?? state.lastDay ?? today;
}

/**
 * A different page opened. A dated page takes over; an undated one keeps
 * the day that was showing. Today is not kept, so on an undated page the
 * sidebar moves on at midnight.
 */
export function afterPageOpened(state: DayRuleState, previousPath: string | null, nextPath: string | null, today: string): DayRuleState {
  const kept = pageDate(nextPath) ?? state.pickedDay ?? pageDate(previousPath) ?? state.lastDay;
  return { pickedDay: null, lastDay: kept === today ? null : kept };
}

/**
 * The arrows or Go to today chose a day. On a dated page the choice holds
 * until another page opens, and choosing the page's own day follows the page
 * again. On an undated page it becomes the kept day; choosing today clears
 * it, so the sidebar moves on at midnight.
 */
export function afterDayPicked(state: DayRuleState, openedPath: string | null, day: string, today: string): DayRuleState {
  const own = pageDate(openedPath);
  if (own) return { ...state, pickedDay: day === own ? null : day };
  return { pickedDay: null, lastDay: day === today ? null : day };
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function at(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date);
}

const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function addDays(day: string, count: number): string {
  const date = at(day);
  date.setDate(date.getDate() + count);
  return iso(date);
}

/** "Wed" */
export const weekdayName = (day: string) => WEEKDAYS[at(day).getDay()];

/** "Oct 28" */
export function shortDayName(day: string): string {
  const date = at(day);
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

/** "Wed, Oct 28" */
export const dayName = (day: string) => `${weekdayName(day)}, ${shortDayName(day)}`;

/** "Today", "Yesterday", "Tomorrow", or nothing. */
export function relativeDayName(day: string, today: string): string | null {
  if (day === today) return 'Today';
  if (day === addDays(today, -1)) return 'Yesterday';
  if (day === addDays(today, 1)) return 'Tomorrow';
  return null;
}
