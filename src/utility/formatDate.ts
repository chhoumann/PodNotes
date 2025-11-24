/**
 * Formats a date using Moment.js-style format tokens for backward compatibility.
 * Common tokens supported:
 * - YYYY: 4-digit year, YY: 2-digit year
 * - MMMM: full month, MMM: abbreviated month, MM: 2-digit month, M: month
 * - DD: 2-digit day, D: day, Do: day with ordinal
 * - dddd: full weekday, ddd: abbreviated weekday
 * - HH: 24h hours, H: 24h hour, hh: 12h hours, h: 12h hour
 * - mm: minutes, m: minute
 * - ss: seconds, s: second
 * - A: AM/PM, a: am/pm
 * - [text]: literal text (escaped, not parsed as tokens)
 */
export function formatDate(date: Date, format: string): string {
    const year = date.getFullYear();
    const month = date.getMonth();
    const day = date.getDate();
    const weekday = date.getDay();
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = date.getSeconds();

    const pad = (n: number): string => n.toString().padStart(2, '0');

    const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const monthNamesShort = [
        'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];
    const weekdayNames = [
        'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
    ];
    const weekdayNamesShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const ordinal = (n: number): string => {
        const s = ['th', 'st', 'nd', 'rd'];
        const v = n % 100;
        return n + (s[(v - 20) % 10] || s[v] || s[0]);
    };

    const hours12 = hours % 12 || 12;
    const isPM = hours >= 12;

    // Token definitions: order matters (longer tokens first to avoid partial matches)
    const tokens: Record<string, string> = {
        'YYYY': year.toString(),
        'YY': year.toString().slice(-2),
        'MMMM': monthNames[month],
        'MMM': monthNamesShort[month],
        'MM': pad(month + 1),
        'Mo': ordinal(month + 1),
        'M': (month + 1).toString(),
        'dddd': weekdayNames[weekday],
        'ddd': weekdayNamesShort[weekday],
        'Do': ordinal(day),
        'DD': pad(day),
        'D': day.toString(),
        'HH': pad(hours),
        'H': hours.toString(),
        'hh': pad(hours12),
        'h': hours12.toString(),
        'mm': pad(minutes),
        'm': minutes.toString(),
        'ss': pad(seconds),
        's': seconds.toString(),
        'A': isPM ? 'PM' : 'AM',
        'a': isPM ? 'pm' : 'am',
    };

    // Build regex pattern: escaped literals [*], then tokens (longest first), then any char
    const tokenPattern = Object.keys(tokens)
        .sort((a, b) => b.length - a.length)
        .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');

    const regex = new RegExp(`\\[([^\\]]*)]|(${tokenPattern})|.`, 'g');

    let result = '';
    let match: RegExpExecArray | null;

    while ((match = regex.exec(format)) !== null) {
        if (match[1] !== undefined) {
            // Escaped literal text inside [...]
            result += match[1];
        } else if (match[2] !== undefined) {
            // Token match
            result += tokens[match[2]];
        } else {
            // Any other character (literal)
            result += match[0];
        }
    }

    return result;
}
