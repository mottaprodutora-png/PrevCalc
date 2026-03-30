import { format, parseISO, isValid } from 'date-fns';

/**
 * Safely formats a date string or Date object.
 * Returns a fallback string if the date is invalid.
 */
export function safeFormat(
  date: Date | string | number | null | undefined,
  formatStr: string,
  fallback: string = '--/--/----'
): string {
  if (!date) return fallback;

  let dateObj: Date;
  if (date instanceof Date) {
    dateObj = date;
  } else if (typeof date === 'string') {
    dateObj = parseISO(date);
    // If parseISO fails, try new Date() as a fallback for other formats
    if (!isValid(dateObj)) {
      dateObj = new Date(date);
    }
  } else {
    dateObj = new Date(date);
  }

  if (!isValid(dateObj)) {
    return fallback;
  }

  try {
    return format(dateObj, formatStr);
  } catch (error) {
    console.error('Error formatting date:', error, { date, formatStr });
    return fallback;
  }
}

/**
 * Checks if a date is valid.
 */
export function isDateValid(date: Date | string | number | null | undefined): boolean {
  if (!date) return false;
  const dateObj = date instanceof Date ? date : new Date(date);
  return isValid(dateObj);
}
