/**
 * Date utility functions for Match & Sip Pickleball
 * Ensures real-time synchronization with local time.
 */

export function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDateToDDMMYYYY(dateStr: string): string {
  try {
    const [year, month, day] = dateStr.split('-');
    if (year && month && day) {
      return `${day}/${month}/${year}`;
    }
    return dateStr;
  } catch {
    return dateStr;
  }
}

export function formatDateToFullReadable(dateStr: string): string {
  try {
    const [year, month, day] = dateStr.split('-').map(Number);
    const d = new Date(year, month - 1, day);
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

export function addDaysToDateStr(dateStr: string, daysToAdd: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  d.setDate(d.getDate() + daysToAdd);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dayNum = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dayNum}`;
}

export function getNextWeekendDay(dateStr: string, targetDay: 0 | 6): string {
  // 0 = Sunday, 6 = Saturday
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  const currentDay = d.getDay();
  let diff = targetDay - currentDay;
  if (diff <= 0) {
    diff += 7;
  }
  d.setDate(d.getDate() + diff);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dayNum = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dayNum}`;
}

/**
 * Formats a confirmed timestamp ISO string, timestamp number, or date string into a clear readable string.
 * Example output: "Sep 28, 2026 • 01:57 AM"
 */
export function formatConfirmedTimestamp(timestamp?: string | number | null): string {
  if (!timestamp) return 'Time not recorded';
  try {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return String(timestamp);

    const datePart = d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

    const timePart = d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    return `${datePart} • ${timePart}`;
  } catch {
    return String(timestamp);
  }
}
