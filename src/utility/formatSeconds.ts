/**
 * Formats a duration in seconds to a time string.
 * Supports common Moment.js-style format tokens for backward compatibility:
 * - H, HH: hours (0-23, 00-23)
 * - h, hh: hours (1-12, 01-12)
 * - m, mm: minutes (0-59, 00-59)
 * - s, ss: seconds (0-59, 00-59)
 * - A: AM/PM, a: am/pm
 */
export function formatSeconds(totalSeconds: number, format: string): string {
    // Clamp non-finite (NaN/Infinity) and negative inputs to 0 so the player never
    // renders garbled times like "NaN:NaN:NaN" or "-1:-1:-10". These arise during
    // an episode switch, when duration is briefly unknown (NaN) before the new
    // audio's metadata loads, or when currentTime momentarily exceeds a shorter
    // next episode's duration (issue #94).
    if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
        totalSeconds = 0;
    }

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = Math.floor(totalSeconds % 60);

    const hours12 = hours % 12 || 12;
    const isPM = hours >= 12;

    const pad = (n: number): string => n.toString().padStart(2, '0');

    return format
        .replace(/HH/g, pad(hours))
        .replace(/H/g, hours.toString())
        .replace(/hh/g, pad(hours12))
        .replace(/h/g, hours12.toString())
        .replace(/mm/g, pad(minutes))
        .replace(/m/g, minutes.toString())
        .replace(/ss/g, pad(secs))
        .replace(/s/g, secs.toString())
        .replace(/A/g, isPM ? 'PM' : 'AM')
        .replace(/a/g, isPM ? 'pm' : 'am');
}