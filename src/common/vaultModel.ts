export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function validDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    localDate(new Date(`${value}T12:00:00`)) === value
  );
}
/** Routine-owned activity starts only at a real level-two heading outside code. */
export function splitDailyLog(body: string): {
  journal: string;
  activity: string;
} {
  let offset = 0;
  let fence: string | null = null;
  for (const line of body.split("\n")) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (
        marker[1][0] === fence[0] &&
        marker[1].length >= fence.length &&
        line.trim() === marker[1]
      )
        fence = null;
    } else if (!fence && /^##\s+Activity Log\s*#*\s*$/.test(line)) {
      return { journal: body.slice(0, offset), activity: body.slice(offset) };
    }
    offset += line.length + 1;
  }
  return { journal: body, activity: "" };
}

/** A new daily page when the vault has no template: hidden properties and an empty page. */
export function defaultDailyPage(date: string): string {
  return `---\ndate: ${date}\ntags:\n  - daily\n---\n`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const two = (value: number) => String(value).padStart(2, "0");

/** The Moment.js tokens a daily template uses, with [brackets] kept as written. */
function formatMoment(format: string, at: Date): string {
  const tokens: Record<string, () => string> = {
    YYYY: () => String(at.getFullYear()),
    YY: () => two(at.getFullYear() % 100),
    MMMM: () => MONTHS[at.getMonth()],
    MMM: () => MONTHS[at.getMonth()].slice(0, 3),
    MM: () => two(at.getMonth() + 1),
    M: () => String(at.getMonth() + 1),
    DD: () => two(at.getDate()),
    D: () => String(at.getDate()),
    dddd: () => WEEKDAYS[at.getDay()],
    ddd: () => WEEKDAYS[at.getDay()].slice(0, 3),
    HH: () => two(at.getHours()),
    H: () => String(at.getHours()),
    mm: () => two(at.getMinutes()),
    ss: () => two(at.getSeconds()),
  };
  return format.replace(
    /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|mm|ss/g,
    (token, literal?: string) => literal ?? tokens[token](),
  );
}

/**
 * Fills a daily template the way Obsidian's daily notes do, so both apps write
 * the same bytes: {{date}} and {{title}} become the date, {{date:FORMAT}}
 * formats it, and {{time}} or {{time:FORMAT}} is the current time.
 */
export function fillDailyTemplate(template: string, date: string, now = new Date()): string {
  const [year, month, day] = date.split("-").map(Number);
  const at = new Date(year, month - 1, day, now.getHours(), now.getMinutes(), now.getSeconds());
  return template
    .replace(/{{\s*title\s*}}/gi, date)
    .replace(/{{\s*(date|time)\s*(?::(.+?))?\s*}}/gi, (_match, kind: string, format?: string) =>
      format
        ? formatMoment(format.trim(), kind.toLowerCase() === "date" ? at : now)
        : kind.toLowerCase() === "date" ? date : formatMoment("HH:mm", now),
    );
}
