import {
  parseDatetimeToEpoch,
  formatDateTime,
  parseFormattedDate,
} from '../../../src/cobolt-backend/datetime_parser';

describe('parseDatetimeToEpoch', () => {
  const validDates = [
    'July 9, 2025, 12:00 AM',
    'July 09, 2025, 12:00 AM',
    'December 07, 2025, 12:00 AM',
    'February 25, 2025, 07:30 PM',
    'February 25, 2025, 07:30 PM UTC-08:00',
    'July 09, 2025, 12:00 AM UTC+00:00',
    'December 31, 2025, 11:59 PM UTC-05:00',
    'Tue, 11 Mar 2025 07:28:00 +0000',
    'Tue, 11 Mar 2025 12:29:12 +0530 (IST)',
    'February 29, 2024, 12:00 AM',
    'January 01, 2025, 12:00 AM',
  ];

  const invalidDates = [
    'February 31, 2025, 12:00 AM IST', // Invalid date
    'Decemsber 31, 2025, 11:59 PM UTC-05:00', // invlid month spelling
  ];

  test('correctly parses dates to epoch time', () => {
    validDates.forEach((input) => {
      expect(() => parseDatetimeToEpoch(input)).not.toThrow();
    });
  });

  test('throws error for invalid date format', () => {
    invalidDates.forEach((input) => {
      expect(() => parseDatetimeToEpoch(input)).toThrow();
    });
  });

  test('throws error for empty string', () => {
    expect(() => parseDatetimeToEpoch('')).toThrow();
  });
});

describe('formatDateTime', () => {
  test('formats Date objects correctly', () => {
    const testCases = [
      {
        input: new Date('2025-07-09T00:00:00.000Z'),
        expected: 'July 08, 2025, 05:00 PM -0700',
      },
      {
        input: new Date('2025-02-25T19:30:00.000Z'),
        expected: 'February 25, 2025, 11:30 AM -0800',
      },
      {
        input: new Date('2025-12-31T23:59:00.000Z'),
        expected: 'December 31, 2025, 03:59 PM -0800',
      },
      {
        input: new Date('2024-02-29T00:00:00.000Z'),
        expected: 'February 28, 2024, 04:00 PM -0800',
      },
    ];

    testCases.forEach(({ input, expected }) => {
      expect(formatDateTime(input)).toBe(expected);
    });
  });

  test('handles Date objects at day boundaries', () => {
    const midnight = new Date('2025-01-01T00:00:00.000Z');
    expect(formatDateTime(midnight)).toBe('December 31, 2024, 04:00 PM -0800');

    const lastMinute = new Date('2025-12-31T23:59:00.000Z');
    expect(formatDateTime(lastMinute)).toBe(
      'December 31, 2025, 03:59 PM -0800',
    );
  });
});

describe('parseFormattedDate', () => {
  test('parses dates correctly to the expected Date objects', () => {
    const testCases = [
      {
        input: 'July 09, 2025, 12:00 AM +0000',
        expected: new Date('2025-07-09T00:00:00.000Z'),
      },
      {
        input: 'February 25, 2025, 07:30 PM +0000',
        expected: new Date('2025-02-25T19:30:00.000Z'),
      },
      {
        input: 'December 31, 2025, 11:59 PM +0000',
        expected: new Date('2025-12-31T23:59:00.000Z'),
      },
      {
        input: 'February 29, 2024, 12:00 AM +0000',
        expected: new Date('2024-02-29T00:00:00.000Z'),
      },
    ];

    testCases.forEach(({ input, expected }) => {
      const result = parseFormattedDate(input);
      expect(result.toISOString()).toBe(expected.toISOString());
    });
  });

  test('handles day boundaries correctly', () => {
    const midnight = 'January 01, 2025, 12:00 AM +0000';
    expect(parseFormattedDate(midnight).toISOString()).toBe(
      '2025-01-01T00:00:00.000Z',
    );

    const lastMinute = 'December 31, 2025, 11:59 PM +0000';
    expect(parseFormattedDate(lastMinute).toISOString()).toBe(
      '2025-12-31T23:59:00.000Z',
    );
  });
});
