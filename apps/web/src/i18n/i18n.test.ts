import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import de from './de';
import en from './en';

function collectFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return collectFiles(p);
    return /\.tsx?$/.test(e.name) && !e.name.endsWith('.test.ts') ? [p] : [];
  });
}

function has(obj: unknown, key: string): boolean {
  let cur: unknown = obj;
  for (const part of key.split('.')) {
    if (!cur || typeof cur !== 'object' || !(part in cur)) return false;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === 'string';
}

describe('Übersetzungen', () => {
  const src = path.resolve(__dirname, '..');
  const keys = new Set<string>();
  for (const file of collectFiles(src)) {
    const text = fs.readFileSync(file, 'utf8');
    // Nur statische Schlüssel t('a.b'); dynamische (Template-Strings) werden übersprungen
    for (const m of text.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) keys.add(m[1]);
  }

  it('findet Schlüssel im Code', () => {
    expect(keys.size).toBeGreaterThan(200);
  });

  it('alle verwendeten Schlüssel existieren auf Deutsch und Englisch', () => {
    const missingDe = [...keys].filter((k) => !has(de, k));
    const missingEn = [...keys].filter((k) => !has(en, k));
    expect(missingDe).toEqual([]);
    expect(missingEn).toEqual([]);
  });
});
