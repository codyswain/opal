import { formatInTimeZone } from 'date-fns-tz';

/**
 * Format a date string to the user's local timezone
 * @param dateString ISO date string or any valid date string
 * @param formatString date-fns format string (default: 'MMM d, yyyy h:mm a')
 * @returns Formatted date string in local timezone
 */
export function formatLocalDate(dateString: string, formatString = 'MMM d, yyyy h:mm a'): string {
  try {
    // Get the user's timezone
    const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // Format the date in the user's timezone
    return formatInTimeZone(new Date(dateString), userTimeZone, formatString);
  } catch (e) {
    console.error('Error formatting date:', e);
    return 'Unknown date';
  }
}

/**
 * Get a Date object in the user's local timezone for comparison
 * @param dateString ISO date string or any valid date string
 * @returns Date object in local timezone
 */
export function getLocalDate(dateString: string): Date {
  try {
    // Create a new Date object from the string
    // JavaScript will automatically interpret this in the local timezone
    return new Date(dateString);
  } catch (e) {
    console.error('Error creating local date:', e);
    return new Date(); // Return current date as fallback
  }
} 