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

    // Order matters: longer tokens must be replaced before shorter ones
    return format
        .replace(/YYYY/g, year.toString())
        .replace(/YY/g, year.toString().slice(-2))
        .replace(/MMMM/g, monthNames[month])
        .replace(/MMM/g, monthNamesShort[month])
        .replace(/MM/g, pad(month + 1))
        .replace(/M/g, (month + 1).toString())
        .replace(/dddd/g, weekdayNames[weekday])
        .replace(/ddd/g, weekdayNamesShort[weekday])
        .replace(/Do/g, ordinal(day))
        .replace(/DD/g, pad(day))
        .replace(/D/g, day.toString())
        .replace(/HH/g, pad(hours))
        .replace(/H/g, hours.toString())
        .replace(/hh/g, pad(hours12))
        .replace(/h/g, hours12.toString())
        .replace(/mm/g, pad(minutes))
        .replace(/m/g, minutes.toString())
        .replace(/ss/g, pad(seconds))
        .replace(/s/g, seconds.toString())
        .replace(/A/g, isPM ? 'PM' : 'AM')
        .replace(/a/g, isPM ? 'pm' : 'am');
}
