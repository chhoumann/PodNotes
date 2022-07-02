export function formatSeconds(seconds: number, format: string) {
    return window.moment().startOf('day').seconds(seconds).format(format);
}