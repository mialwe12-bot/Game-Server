export interface ByteRange {
  start: number;
  end: number; // inklusiv
}

/**
 * Parst einen HTTP Range-Header (nur ein Bereich, wie von Download-Managern verwendet).
 * Rückgabe: null = kein/ignorierter Range-Header, 'unsatisfiable' = 416.
 */
export function parseRange(header: string | undefined, size: number): ByteRange | null | 'unsatisfiable' {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null; // Mehrfachbereiche oder ungültig → ganze Datei
  const [, startStr, endStr] = match;
  if (startStr === '' && endStr === '') return null;
  let start: number;
  let end: number;
  if (startStr === '') {
    const suffix = Number(endStr);
    if (suffix === 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startStr);
    end = endStr === '' ? size - 1 : Math.min(Number(endStr), size - 1);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return 'unsatisfiable';
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}
