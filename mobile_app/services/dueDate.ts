/**
 * Formatting helpers for assignment due dates.
 *
 * The API stores `due_date` as a full ISO datetime (UTC), so a deadline can
 * carry a real time of day — "due Friday 5:00 PM" rather than midnight.
 */

export interface DueParts {
  isOverdue: boolean;
  /** Whole days until the deadline; negative once it has passed. */
  daysLeft: number;
  /** Human label, e.g. "Due in 2 days" / "Due today, 11:59 PM" / "Overdue by 3 hours". */
  label: string;
  /** Short form for dense list rows, e.g. "Sep 30, 5:00 PM". */
  short: string;
}

const MS_PER_HOUR = 60 * 60 * 1000;

/** "Sep 30, 5:00 PM" — omits the year when the deadline is this year. */
export function formatDueShort(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return 'No due date';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'No due date';

  const sameYear = date.getFullYear() === now.getFullYear();
  const day = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day}, ${time}`;
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

export function describeDue(iso: string | null | undefined, now = new Date()): DueParts {
  const short = formatDueShort(iso, now);
  if (!iso) {
    return { isOverdue: false, daysLeft: Infinity, label: 'No due date', short };
  }

  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) {
    return { isOverdue: false, daysLeft: Infinity, label: 'No due date', short };
  }

  const msLeft = due.getTime() - now.getTime();
  const isOverdue = msLeft < 0;
  // Compare calendar days, not 24h blocks, so "tomorrow 9am" is one day away
  // even though it is only 20 hours.
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDue = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  const daysLeft = Math.round((startOfDue - startOfToday) / (24 * MS_PER_HOUR));

  let label: string;
  if (isOverdue) {
    const hoursLate = Math.floor(-msLeft / MS_PER_HOUR);
    if (hoursLate < 1) {
      label = 'Overdue';
    } else if (hoursLate < 24) {
      label = `Overdue by ${plural(hoursLate, 'hour')}`;
    } else {
      label = `Overdue by ${plural(Math.floor(hoursLate / 24), 'day')}`;
    }
  } else if (daysLeft === 0) {
    label = `Due today, ${due.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  } else if (daysLeft === 1) {
    label = 'Due tomorrow';
  } else if (daysLeft <= 7) {
    label = `Due in ${plural(daysLeft, 'day')}`;
  } else {
    label = `Due ${short}`;
  }

  return { isOverdue, daysLeft, label, short };
}

/**
 * Convert a local Date to the ISO string the API expects.
 * The offset is sent explicitly so the server stores the wall-clock time the
 * educator actually picked, not a UTC-shifted version of it.
 */
export function toApiDueDate(date: Date): string {
  return date.toISOString();
}
