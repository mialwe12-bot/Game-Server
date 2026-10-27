import { describe, expect, it } from 'vitest';
import { pickNext, type Box } from './spatial';

// Raster 3×2 aus 100×100-Kacheln mit 20 px Abstand
const grid: Box[] = [];
for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) grid.push({ x: c * 120, y: r * 120, w: 100, h: 100 });
const others = (i: number) => grid.filter((_, j) => j !== i);
const idx = (from: number, list: Box[], hit: number) => grid.indexOf(list[hit]);

describe('räumliche Navigation', () => {
  it('bewegt sich in Reihen und Spalten', () => {
    expect(idx(0, others(0), pickNext(grid[0], others(0), 'right'))).toBe(1);
    expect(idx(0, others(0), pickNext(grid[0], others(0), 'down'))).toBe(3);
    expect(idx(4, others(4), pickNext(grid[4], others(4), 'up'))).toBe(1);
    expect(idx(4, others(4), pickNext(grid[4], others(4), 'left'))).toBe(3);
  });

  it('liefert -1 am Rand', () => {
    expect(pickNext(grid[0], others(0), 'left')).toBe(-1);
    expect(pickNext(grid[0], others(0), 'up')).toBe(-1);
  });

  it('bevorzugt dieselbe Reihe gegenüber einem näheren, versetzten Element', () => {
    const from: Box = { x: 0, y: 0, w: 100, h: 100 };
    const sameRowFar: Box = { x: 300, y: 0, w: 100, h: 100 };
    const offsetNear: Box = { x: 130, y: 160, w: 100, h: 100 };
    expect(pickNext(from, [offsetNear, sameRowFar], 'right')).toBe(1);
  });
});
