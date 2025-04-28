import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

// Extend dayjs with required plugins
dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

// Month name to index mapping
const MONTH_NAME_TO_INDEX: Record<string, number> = {
  'january': 0, 'february': 1, 'march': 2, 'april': 3, 'may': 4, 'june': 5,
  'july': 6, 'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11
};

// Organize formats by category for better maintainability
const FORMATS = {
  basic: [
    'MMMM D, YYYY, h:mm A',
    'MMMM DD, YYYY, h:mm A',
    'MMMM D, YYYY, hh:mm A',
    'MMMM DD, YYYY, hh:mm A'
  ],
  utc: [
    'MMMM D, YYYY, h:mm A UTC[+]ZZ',
    'MMMM D, YYYY, h:mm A UTC[-]ZZ',
    'MMMM DD, YYYY, h:mm A UTC[+]ZZ',
    'MMMM DD, YYYY, h:mm A UTC[-]ZZ',
    'MMMM D, YYYY, hh:mm A UTC[+]ZZ',
    'MMMM D, YYYY, hh:mm A UTC[-]ZZ',
    'MMMM DD, YYYY, hh:mm A UTC[+]ZZ',
    'MMMM DD, YYYY, hh:mm A UTC[-]ZZ'
  ],
  timezone: [
    'MMMM D, YYYY, h:mm A ZZ',
    'MMMM DD, YYYY, h:mm A ZZ',
    'MMMM D, YYYY, hh:mm A ZZ',
    'MMMM DD, YYYY, hh:mm A ZZ'
  ],
  rfc2822: [
    'ddd, DD MMM YYYY HH:mm:ss ZZ',
    'ddd, D MMM YYYY HH:mm:ss ZZ'
  ],
  custom: [
    'MMMM D, YYYY, h:mm A [IST]',
    'MMMM DD, YYYY, h:mm A [IST]'
  ]
};

/**
 * Validates that a date string represents a valid calendar date.
 * Returns false if month is misspelled or day is invalid for the given month/year.
 * 
 * @param dateString Date string to validate
 * @returns Whether the date is valid
 */
function isValidDate(dateString: string): boolean {
  // Extract potential month, day and year with a more permissive regex
  const match = dateString.match(/\b([A-Za-z]+)\s+(\d{1,2}),\s+(\d{1,4})/i);
  if (!match) return true; // Can't validate without a month-like pattern

  const potentialMonth = match[1].toLowerCase();
  const day = parseInt(match[2], 10);
  const year = parseInt(match[3], 10);

  if (!(potentialMonth in MONTH_NAME_TO_INDEX)) {
    return false;
  }

  const monthIndex = MONTH_NAME_TO_INDEX[potentialMonth];
  const lastDayOfMonth = new Date(year, monthIndex + 1, 0).getDate();
  return day >= 1 && day <= lastDayOfMonth;
}

/**
 * Parses a date string into an epoch timestamp using dayjs.
 * @param datetimeStr The date string to parse
 * @returns The epoch timestamp
 * @throws If the date string is invalid or doesn't match any format
 */
function parseDatetimeToEpoch(datetimeStr: string): number {
  const trimmedDatetime = datetimeStr.trim().replace(/\s+\(\w+\)$/, '');

  if (!isValidDate(trimmedDatetime)) {
    throw new Error('invalid date format');
  }

  // All formats combined
  const formats = [
    ...FORMATS.basic,
    ...FORMATS.utc,
    ...FORMATS.timezone,
    ...FORMATS.rfc2822,
    ...FORMATS.custom
  ];

  // Try strict parsing with all formats
  for (const format of formats) {
    const date = dayjs(trimmedDatetime, format, true);
    if (date.isValid()) {
      return date.unix();
    }
  }

  // Special case for RFC 2822
  if (/^[A-Za-z]{3}, \d{1,2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} [+-]\d{4}$/.test(trimmedDatetime)) {
    const date = dayjs(trimmedDatetime);
    if (date.isValid()) {
      return date.unix();
    }
  }

  // Fallback to non-strict parsing
  const date = dayjs(trimmedDatetime);
  if (date.isValid()) {
    return date.unix();
  }

  throw new Error(`Invalid date format: <${datetimeStr}>`);
}

const standardFormat = 'MMMM DD, YYYY, hh:mm A ZZ';

/**
 * Formats a Date object into a standardized string format
 * @param date The Date object to format
 * @returns Formatted date string in format 'MMMM DD, YYYY, hh:mm A ZZ'
 */
function formatDateTime(date: Date): string {
  return dayjs(date).format(standardFormat);
}

/**
 * Parses a formatted date string into a Date object
 * @param dateStr The date string in format 'MMMM DD, YYYY, hh:mm A ZZ'
 * @returns Date object
 * @throws If the date string is invalid
 */
function parseFormattedDate(dateStr: string): Date {
  const unixDate = parseDatetimeToEpoch(dateStr);
  const date = new Date(unixDate * 1000);
  return date;
}

export { parseDatetimeToEpoch, formatDateTime, parseFormattedDate };