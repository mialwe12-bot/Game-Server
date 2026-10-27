import { describe, expect, it } from 'vitest';
import { compareVersions } from './semver.js';

describe('compareVersions', () => {
  it('vergleicht numerisch und behandelt Vorabversionen', () => {
    expect(compareVersions('1.2.10', '1.2.9')).toBe(1);
    expect(compareVersions('1.2.0', '1.2')).toBe(0);
    expect(compareVersions('v2.0.0', '1.99.99')).toBe(1);
    expect(compareVersions('1.0.0-beta.2', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0-beta.10', '1.0.0-beta.2')).toBe(1);
    expect(compareVersions('0.9.0', '1.0.0')).toBe(-1);
  });
});
