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
