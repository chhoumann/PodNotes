import type { CSSObject } from "src/types/CSSObject";

export default function extractStylesFromObj(obj: CSSObject): string {
    return Object.entries(obj)
        .map(([key, value]) => `${key}: ${value}`)
        .join('; ')
}