import { describe, it, expect } from 'vitest';
import { formatDate } from './formatDate';

describe('formatDate', () => {
    // Fixed date for consistent testing: Friday, March 1, 2024, 10:05:03 AM
    const testDate = new Date('2024-03-01T10:05:03');

    // Date with PM time: Saturday, November 23, 2024, 2:30:45 PM
    const pmDate = new Date('2024-11-23T14:30:45');

    // Midnight edge case
    const midnightDate = new Date('2024-01-01T00:00:00');

    // Noon edge case
    const noonDate = new Date('2024-01-01T12:00:00');

    describe('year tokens', () => {
        it('formats YYYY as 4-digit year', () => {
            expect(formatDate(testDate, 'YYYY')).toBe('2024');
        });

        it('formats YY as 2-digit year', () => {
            expect(formatDate(testDate, 'YY')).toBe('24');
        });

        it('handles year at turn of century', () => {
            const y2k = new Date('2000-06-15T12:00:00');
            expect(formatDate(y2k, 'YY')).toBe('00');
            expect(formatDate(y2k, 'YYYY')).toBe('2000');
        });
    });

    describe('month tokens', () => {
        it('formats MMMM as full month name', () => {
            expect(formatDate(testDate, 'MMMM')).toBe('March');
        });

        it('formats MMM as abbreviated month name', () => {
            expect(formatDate(testDate, 'MMM')).toBe('Mar');
        });

        it('formats MM as zero-padded month number', () => {
            expect(formatDate(testDate, 'MM')).toBe('03');
        });

        it('formats M as month number without padding', () => {
            expect(formatDate(testDate, 'M')).toBe('3');
        });

        it('formats all 12 months correctly with MMMM', () => {
            const monthNames = [
                'January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'
            ];
            monthNames.forEach((name, index) => {
                const date = new Date(2024, index, 15, 10, 30, 0);
                expect(formatDate(date, 'MMMM')).toBe(name);
            });
        });

        it('formats all 12 months correctly with MMM', () => {
            const monthNames = [
                'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
            ];
            monthNames.forEach((name, index) => {
                const date = new Date(2024, index, 15, 10, 30, 0);
                expect(formatDate(date, 'MMM')).toBe(name);
            });
        });
    });

    describe('day tokens', () => {
        it('formats DD as zero-padded day', () => {
            expect(formatDate(testDate, 'DD')).toBe('01');
        });

        it('formats D as day without padding', () => {
            expect(formatDate(testDate, 'D')).toBe('1');
        });

        it('formats Do with ordinal suffix', () => {
            expect(formatDate(testDate, 'Do')).toBe('1st');
            expect(formatDate(new Date('2024-03-02T10:00:00'), 'Do')).toBe('2nd');
            expect(formatDate(new Date('2024-03-03T10:00:00'), 'Do')).toBe('3rd');
            expect(formatDate(new Date('2024-03-04T10:00:00'), 'Do')).toBe('4th');
            expect(formatDate(new Date('2024-03-11T10:00:00'), 'Do')).toBe('11th');
            expect(formatDate(new Date('2024-03-12T10:00:00'), 'Do')).toBe('12th');
            expect(formatDate(new Date('2024-03-13T10:00:00'), 'Do')).toBe('13th');
            expect(formatDate(new Date('2024-03-21T10:00:00'), 'Do')).toBe('21st');
            expect(formatDate(new Date('2024-03-22T10:00:00'), 'Do')).toBe('22nd');
            expect(formatDate(new Date('2024-03-23T10:00:00'), 'Do')).toBe('23rd');
            expect(formatDate(new Date('2024-03-31T10:00:00'), 'Do')).toBe('31st');
        });
    });

    describe('weekday tokens', () => {
        it('formats dddd as full weekday name', () => {
            expect(formatDate(testDate, 'dddd')).toBe('Friday');
        });

        it('formats ddd as abbreviated weekday name', () => {
            expect(formatDate(testDate, 'ddd')).toBe('Fri');
        });

        it('formats all 7 weekdays correctly with dddd', () => {
            const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            // 2024-03-03 is a Sunday
            weekdays.forEach((name, index) => {
                const date = new Date(2024, 2, 3 + index, 10, 0, 0);
                expect(formatDate(date, 'dddd')).toBe(name);
            });
        });

        it('formats all 7 weekdays correctly with ddd', () => {
            const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            weekdays.forEach((name, index) => {
                const date = new Date(2024, 2, 3 + index, 10, 0, 0);
                expect(formatDate(date, 'ddd')).toBe(name);
            });
        });
    });

    describe('hour tokens', () => {
        it('formats HH as zero-padded 24-hour', () => {
            expect(formatDate(testDate, 'HH')).toBe('10');
            expect(formatDate(pmDate, 'HH')).toBe('14');
            expect(formatDate(midnightDate, 'HH')).toBe('00');
        });

        it('formats H as 24-hour without padding', () => {
            expect(formatDate(testDate, 'H')).toBe('10');
            expect(formatDate(pmDate, 'H')).toBe('14');
            expect(formatDate(midnightDate, 'H')).toBe('0');
        });

        it('formats hh as zero-padded 12-hour', () => {
            expect(formatDate(testDate, 'hh')).toBe('10');
            expect(formatDate(pmDate, 'hh')).toBe('02');
            expect(formatDate(midnightDate, 'hh')).toBe('12');
            expect(formatDate(noonDate, 'hh')).toBe('12');
        });

        it('formats h as 12-hour without padding', () => {
            expect(formatDate(testDate, 'h')).toBe('10');
            expect(formatDate(pmDate, 'h')).toBe('2');
            expect(formatDate(midnightDate, 'h')).toBe('12');
            expect(formatDate(noonDate, 'h')).toBe('12');
        });
    });

    describe('minute tokens', () => {
        it('formats mm as zero-padded minutes', () => {
            expect(formatDate(testDate, 'mm')).toBe('05');
            expect(formatDate(pmDate, 'mm')).toBe('30');
        });

        it('formats m as minutes without padding', () => {
            expect(formatDate(testDate, 'm')).toBe('5');
            expect(formatDate(pmDate, 'm')).toBe('30');
        });
    });

    describe('second tokens', () => {
        it('formats ss as zero-padded seconds', () => {
            expect(formatDate(testDate, 'ss')).toBe('03');
            expect(formatDate(pmDate, 'ss')).toBe('45');
        });

        it('formats s as seconds without padding', () => {
            expect(formatDate(testDate, 's')).toBe('3');
            expect(formatDate(pmDate, 's')).toBe('45');
        });
    });

    describe('AM/PM tokens', () => {
        it('formats A as uppercase AM/PM', () => {
            expect(formatDate(testDate, 'A')).toBe('AM');
            expect(formatDate(pmDate, 'A')).toBe('PM');
            expect(formatDate(midnightDate, 'A')).toBe('AM');
            expect(formatDate(noonDate, 'A')).toBe('PM');
        });

        it('formats a as lowercase am/pm', () => {
            expect(formatDate(testDate, 'a')).toBe('am');
            expect(formatDate(pmDate, 'a')).toBe('pm');
        });
    });

    describe('sequential replacement corruption bug', () => {
        // This is the critical bug that was fixed - month/weekday names
        // containing letters like 'h', 'm', 's' were being corrupted
        // by subsequent time replacements

        it('does NOT corrupt "March" with hour replacement (the original bug)', () => {
            // March contains 'h' which should NOT be replaced by hour
            const marchDate = new Date('2024-03-01T10:00:00');
            expect(formatDate(marchDate, 'MMMM')).toBe('March');
            expect(formatDate(marchDate, 'MMMM')).not.toContain('10');
        });

        it('does NOT corrupt "March" at any hour', () => {
            for (let hour = 0; hour < 24; hour++) {
                const date = new Date(2024, 2, 1, hour, 0, 0);
                const result = formatDate(date, 'MMMM');
                expect(result).toBe('March');
            }
        });

        it('does NOT corrupt month names containing "h"', () => {
            // March (h)
            expect(formatDate(new Date('2024-03-15T14:30:00'), 'MMMM')).toBe('March');
        });

        it('does NOT corrupt month names containing "m"', () => {
            // September, November, December contain 'm'
            expect(formatDate(new Date('2024-09-15T10:45:00'), 'MMMM')).toBe('September');
            expect(formatDate(new Date('2024-11-15T10:45:00'), 'MMMM')).toBe('November');
            expect(formatDate(new Date('2024-12-15T10:45:00'), 'MMMM')).toBe('December');
        });

        it('does NOT corrupt month names containing "s"', () => {
            // August contains 's'
            expect(formatDate(new Date('2024-08-15T10:30:45'), 'MMMM')).toBe('August');
        });

        it('does NOT corrupt abbreviated months', () => {
            expect(formatDate(new Date('2024-03-15T10:00:00'), 'MMM')).toBe('Mar');
            expect(formatDate(new Date('2024-09-15T10:00:00'), 'MMM')).toBe('Sep');
            expect(formatDate(new Date('2024-08-15T10:00:00'), 'MMM')).toBe('Aug');
        });

        it('does NOT corrupt weekday names containing "h"', () => {
            // Thursday contains 'h'
            const thursday = new Date('2024-03-07T10:00:00'); // Thursday
            expect(formatDate(thursday, 'dddd')).toBe('Thursday');
        });

        it('does NOT corrupt weekday names containing "m"', () => {
            // No weekday contains 'm' but test anyway for safety
            const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            weekdays.forEach((name, index) => {
                const date = new Date(2024, 2, 3 + index, 10, 30, 0);
                expect(formatDate(date, 'dddd')).toBe(name);
            });
        });

        it('does NOT corrupt weekday names containing "s"', () => {
            // Tuesday, Wednesday, Thursday, Saturday contain 's'
            expect(formatDate(new Date('2024-03-05T10:30:45'), 'dddd')).toBe('Tuesday');
            expect(formatDate(new Date('2024-03-06T10:30:45'), 'dddd')).toBe('Wednesday');
            expect(formatDate(new Date('2024-03-07T10:30:45'), 'dddd')).toBe('Thursday');
            expect(formatDate(new Date('2024-03-09T10:30:45'), 'dddd')).toBe('Saturday');
        });

        it('does NOT corrupt "Monday" (contains "M" which is a month token)', () => {
            const monday = new Date('2024-03-04T10:00:00');
            expect(formatDate(monday, 'dddd')).toBe('Monday');
        });

        it('does NOT corrupt "Sunday" (contains "D" which is a day token)', () => {
            const sunday = new Date('2024-03-03T10:00:00');
            expect(formatDate(sunday, 'dddd')).toBe('Sunday');
        });

        it('does NOT corrupt ordinal suffixes', () => {
            // 'st', 'nd', 'rd', 'th' contain 's' and 'h'
            expect(formatDate(new Date('2024-03-01T10:30:45'), 'Do')).toBe('1st');
            expect(formatDate(new Date('2024-03-02T10:30:45'), 'Do')).toBe('2nd');
            expect(formatDate(new Date('2024-03-03T10:30:45'), 'Do')).toBe('3rd');
            expect(formatDate(new Date('2024-03-04T10:30:45'), 'Do')).toBe('4th');
        });

        it('does NOT corrupt AM/PM markers', () => {
            // 'AM' contains 'M', 'PM' contains 'M'
            expect(formatDate(new Date('2024-03-01T09:00:00'), 'A')).toBe('AM');
            expect(formatDate(new Date('2024-03-01T15:00:00'), 'A')).toBe('PM');
            expect(formatDate(new Date('2024-03-01T09:00:00'), 'a')).toBe('am');
            expect(formatDate(new Date('2024-03-01T15:00:00'), 'a')).toBe('pm');
        });
    });

    describe('complex format strings', () => {
        it('formats full date and time correctly', () => {
            expect(formatDate(testDate, 'YYYY-MM-DD HH:mm:ss')).toBe('2024-03-01 10:05:03');
        });

        it('formats human-readable date', () => {
            expect(formatDate(testDate, 'MMMM Do, YYYY')).toBe('March 1st, 2024');
        });

        it('formats with weekday', () => {
            expect(formatDate(testDate, 'dddd, MMMM Do, YYYY')).toBe('Friday, March 1st, 2024');
        });

        it('formats 12-hour time with AM/PM', () => {
            expect(formatDate(testDate, 'h:mm A')).toBe('10:05 AM');
            expect(formatDate(pmDate, 'h:mm A')).toBe('2:30 PM');
        });

        it('formats ISO-like date', () => {
            expect(formatDate(testDate, 'YYYY-MM-DDTHH:mm:ss')).toBe('2024-03-01T10:05:03');
        });

        it('formats US-style date', () => {
            expect(formatDate(pmDate, 'MM/DD/YYYY')).toBe('11/23/2024');
        });

        it('formats European-style date', () => {
            expect(formatDate(pmDate, 'DD/MM/YYYY')).toBe('23/11/2024');
        });

        it('handles format with all token types combined', () => {
            const result = formatDate(testDate, 'dddd, MMMM Do YYYY, h:mm:ss a');
            expect(result).toBe('Friday, March 1st 2024, 10:05:03 am');
        });

        it('handles format with repeated tokens', () => {
            expect(formatDate(testDate, 'YYYY YYYY YYYY')).toBe('2024 2024 2024');
            expect(formatDate(testDate, 'MMMM MMMM')).toBe('March March');
        });

        it('preserves literal text in format string using escape syntax', () => {
            // In Moment.js style, literal text containing token characters must be escaped with [...]
            expect(formatDate(testDate, '[Year]: YYYY')).toBe('Year: 2024');
            expect(formatDate(testDate, '[Today is] dddd')).toBe('Today is Friday');
            expect(formatDate(testDate, '[The date is] MMMM Do')).toBe('The date is March 1st');
            expect(formatDate(testDate, 'YYYY-MM-DD[T]HH:mm:ss')).toBe('2024-03-01T10:05:03');
        });
    });

    describe('edge cases', () => {
        it('handles empty format string', () => {
            expect(formatDate(testDate, '')).toBe('');
        });

        it('handles format string with no tokens (escaped)', () => {
            // Literal text with token characters must be escaped
            expect(formatDate(testDate, '[Hello World]')).toBe('Hello World');
            expect(formatDate(testDate, '---')).toBe('---');
            expect(formatDate(testDate, '/')).toBe('/');
        });

        it('handles single-digit values correctly', () => {
            const date = new Date('2024-01-05T03:07:09');
            expect(formatDate(date, 'M')).toBe('1');
            expect(formatDate(date, 'D')).toBe('5');
            expect(formatDate(date, 'H')).toBe('3');
            expect(formatDate(date, 'm')).toBe('7');
            expect(formatDate(date, 's')).toBe('9');
        });

        it('handles double-digit values correctly', () => {
            const date = new Date('2024-12-25T23:45:59');
            expect(formatDate(date, 'MM')).toBe('12');
            expect(formatDate(date, 'DD')).toBe('25');
            expect(formatDate(date, 'HH')).toBe('23');
            expect(formatDate(date, 'mm')).toBe('45');
            expect(formatDate(date, 'ss')).toBe('59');
        });

        it('handles year boundaries', () => {
            const newYearsEve = new Date('2024-12-31T23:59:59');
            const newYearsDay = new Date('2025-01-01T00:00:00');

            expect(formatDate(newYearsEve, 'YYYY-MM-DD HH:mm:ss')).toBe('2024-12-31 23:59:59');
            expect(formatDate(newYearsDay, 'YYYY-MM-DD HH:mm:ss')).toBe('2025-01-01 00:00:00');
        });

        it('handles leap year date', () => {
            const leapDay = new Date('2024-02-29T12:00:00');
            expect(formatDate(leapDay, 'MMMM D, YYYY')).toBe('February 29, 2024');
        });
    });

    describe('stress tests for replacement corruption', () => {
        it('survives all month/hour combinations', () => {
            const months = [
                'January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'
            ];

            for (let month = 0; month < 12; month++) {
                for (let hour = 0; hour < 24; hour++) {
                    const date = new Date(2024, month, 15, hour, 30, 45);
                    const result = formatDate(date, 'MMMM');
                    expect(result).toBe(months[month]);
                }
            }
        });

        it('survives all weekday/minute combinations', () => {
            const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

            for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
                for (let minute = 0; minute < 60; minute += 10) {
                    const date = new Date(2024, 2, 3 + dayOffset, 10, minute, 0);
                    const result = formatDate(date, 'dddd');
                    expect(result).toBe(weekdays[dayOffset]);
                }
            }
        });

        it('survives all ordinal/second combinations', () => {
            for (let day = 1; day <= 31; day++) {
                for (let second = 0; second < 60; second += 15) {
                    const date = new Date(2024, 0, day, 10, 30, second);
                    const result = formatDate(date, 'Do');
                    expect(result).toMatch(/^\d+(st|nd|rd|th)$/);
                    expect(result.startsWith(day.toString())).toBe(true);
                }
            }
        });

        it('handles worst-case format with all potentially conflicting tokens', () => {
            // This format uses every token type that could potentially corrupt each other
            // Note: 'at' must be escaped as '[at]' because 'a' is a token
            const format = 'dddd, MMMM Do, YYYY [at] h:mm:ss a (HH:mm:ss A)';

            // Test across various dates and times
            const testCases = [
                { date: new Date('2024-03-01T10:05:03'), expected: 'Friday, March 1st, 2024 at 10:05:03 am (10:05:03 AM)' },
                { date: new Date('2024-08-15T14:30:45'), expected: 'Thursday, August 15th, 2024 at 2:30:45 pm (14:30:45 PM)' },
                { date: new Date('2024-09-22T00:00:00'), expected: 'Sunday, September 22nd, 2024 at 12:00:00 am (00:00:00 AM)' },
                { date: new Date('2024-11-07T23:59:59'), expected: 'Thursday, November 7th, 2024 at 11:59:59 pm (23:59:59 PM)' },
            ];

            testCases.forEach(({ date, expected }) => {
                expect(formatDate(date, format)).toBe(expected);
            });
        });

        it('handles pathological format strings', () => {
            // Format strings designed to maximize corruption potential
            expect(formatDate(testDate, 'MMMMMMMMMhhhhhssss')).toMatch(/^March/);
            expect(formatDate(testDate, 'hhhhMMMM')).toContain('March');
            expect(formatDate(testDate, 'ssssdddd')).toContain('Friday');
        });
    });

    describe('escape syntax [...]', () => {
        it('escapes single characters', () => {
            expect(formatDate(testDate, '[H]H')).toBe('H10');
            expect(formatDate(testDate, '[m]m')).toBe('m5');
            expect(formatDate(testDate, '[a]')).toBe('a');
            expect(formatDate(testDate, '[M]')).toBe('M');
        });

        it('escapes words containing token characters', () => {
            expect(formatDate(testDate, '[at] h:mm a')).toBe('at 10:05 am');
            expect(formatDate(testDate, '[March] MMMM')).toBe('March March');
            expect(formatDate(testDate, '[Hour]: H')).toBe('Hour: 10');
        });

        it('handles multiple escape sequences', () => {
            expect(formatDate(testDate, '[Date]: YYYY-MM-DD [Time]: HH:mm:ss')).toBe('Date: 2024-03-01 Time: 10:05:03');
        });

        it('handles empty escape sequences', () => {
            expect(formatDate(testDate, '[]YYYY')).toBe('2024');
            expect(formatDate(testDate, 'YYYY[]')).toBe('2024');
        });

        it('handles escape sequences with special regex characters', () => {
            expect(formatDate(testDate, '[.*+?^${}()|]')).toBe('.*+?^${}()|');
            expect(formatDate(testDate, '[\\]')).toBe('\\');
        });

        it('handles nested brackets (edge case)', () => {
            // The first ] closes the escape, subsequent brackets are literal
            expect(formatDate(testDate, '[[test]]')).toBe('[test]');
        });
    });

    describe('token isolation', () => {
        // Verify that each token type is properly isolated and doesn't affect others

        it('M token does not affect MMMM in same format', () => {
            const result = formatDate(testDate, 'M MMMM');
            expect(result).toBe('3 March');
        });

        it('D token does not affect dddd in same format', () => {
            const result = formatDate(testDate, 'D dddd');
            expect(result).toBe('1 Friday');
        });

        it('h token does not affect HH in same format', () => {
            const result = formatDate(pmDate, 'h HH');
            expect(result).toBe('2 14');
        });

        it('m token does not affect mm in same format', () => {
            const result = formatDate(testDate, 'm mm');
            expect(result).toBe('5 05');
        });

        it('s token does not affect ss in same format', () => {
            const result = formatDate(testDate, 's ss');
            expect(result).toBe('3 03');
        });

        it('a token does not affect A in same format', () => {
            const result = formatDate(testDate, 'a A');
            expect(result).toBe('am AM');
        });
    });
});
