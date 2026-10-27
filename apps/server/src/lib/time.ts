export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
export const DAY_MS = 24 * 60 * 60 * 1000;
