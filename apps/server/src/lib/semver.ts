/** Vergleicht Versionsnummern wie "1.2.10" und "1.2.9-beta.1" (vereinfachtes SemVer). */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre = ''] = v.trim().replace(/^v/i, '').split('-', 2);
    return { nums: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1; // Release > Vorabversion
  if (!y.pre) return -1;
  return x.pre.localeCompare(y.pre, undefined, { numeric: true }) > 0 ? 1 : -1;
}
