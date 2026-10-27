import path from 'node:path';

/**
 * Normalisiert einen relativen Dateipfad innerhalb eines Builds und verhindert Path Traversal.
 * Gibt null zurück, wenn der Pfad ungültig ist.
 */
export function normalizeRelPath(input: string): string | null {
  const unified = input.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!unified || unified.includes('\0')) return null;
  const parts = unified.split('/').filter((p) => p !== '' && p !== '.');
  if (parts.length === 0 || parts.some((p) => p === '..')) return null;
  if (parts.some((p) => /[<>:"|?*\x00-\x1f]/.test(p))) return null;
  const joined = parts.join('/');
  if (joined.length > 1024) return null;
  return path.posix.normalize(joined);
}
