/** Display formatting for timestamps. "Now" is always the real clock. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Local midnight of the given day. */
export function startOfLocalDay(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Short label for list rows: "Today", "Yest" or "Oct 12". */
export function formatScanDate(timestamp: number, now: Date = new Date()): string {
  const date = new Date(timestamp);
  if (isSameLocalDay(date, now)) return 'Today';

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameLocalDay(date, yesterday)) return 'Yest';

  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

/** Full label for record headers: "Oct 14, 2026 · 10:42 AM". */
export function formatFullScanDate(timestamp: number): string {
  const date = new Date(timestamp);
  const hours24 = date.getHours();
  const hours12 = hours24 % 12 || 12;
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours24 >= 12 ? 'PM' : 'AM';
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()} · ${hours12}:${minutes} ${ampm}`;
}

/** "Dr. Sarah Lin, MD" → "SL". Falls back to "?" for empty names. */
export function initialsFromName(name: string | null | undefined): string {
  const words = (name ?? '')
    .replace(/^(dr|prof|mr|mrs|ms)\.?\s+/i, '')
    .replace(/,.*$/, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : '';
  return (first + last).toUpperCase();
}
