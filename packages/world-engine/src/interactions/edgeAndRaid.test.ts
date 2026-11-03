/** Edge-pinned viewer bubbles (geometry) and the raid chip count / cluster anchor. Pure, runs in Node. */
import { describe, expect, it } from 'vitest';
import { edgePin, placeBubble, type BubbleSlot, type EdgePin, type Placement, type SafeArea } from './bubbleLayout';
import { densestMember, raidChipCount, raidChipText } from './raidChip';

const AREA: SafeArea = { minL: 12, maxR: 1268, minT: 12, maxB: 708 };
const pin: EdgePin = { cx: 0, cy: 0, ux: 0, uy: 0 };
const inside = (p: EdgePin, w: number, h: number) =>
  p.cx - w / 2 >= AREA.minL - 1e-6 && p.cx + w / 2 <= AREA.maxR + 1e-6 && p.cy - h / 2 >= AREA.minT - 1e-6 && p.cy + h / 2 <= AREA.maxB + 1e-6;

describe('edge bubbles', () => {
  it('pins the box on the safe-area border toward an off-screen speaker, fully inside', () => {
    edgePin(2000, 360, 200, 50, AREA, 0, pin);            // far right
    expect(pin.cx + 100).toBeCloseTo(AREA.maxR, 3);
    expect(Math.abs(pin.cy - 360)).toBeLessThan(1);
    expect(inside(pin, 200, 50)).toBe(true);
    edgePin(640, -900, 200, 50, AREA, 0, pin);            // above the top
    expect(pin.cy - 25).toBeCloseTo(AREA.minT, 3);
    expect(inside(pin, 200, 50)).toBe(true);
    edgePin(-5000, 5000, 220, 60, AREA, 0, pin);           // bottom-left, far away
    expect(inside(pin, 220, 60)).toBe(true);
    expect(pin.ux).toBeLessThan(0); expect(pin.uy).toBeGreaterThan(0);
  });

  it('slides inward on retries and handles a speaker at the centre', () => {
    edgePin(2000, 360, 200, 50, AREA, 0, pin);
    const x0 = pin.cx;
    edgePin(2000, 360, 200, 50, AREA, 0.5, pin);
    expect(pin.cx).toBeLessThan(x0);
    expect(pin.cx).toBeGreaterThan((AREA.minL + AREA.maxR) / 2);
    edgePin(640, 360, 200, 50, AREA, 0, pin);              // degenerate: bottom edge
    expect(pin.cy + 25).toBeCloseTo(AREA.maxB, 3);
  });

  it('two edge bubbles toward the same side do not overlap (slot search with the first as obstacle)', () => {
    const out: Placement = { dx: 0, dy: 0, cost: 0, softHits: 0 };
    const hard = new Float32Array(4 * 4);
    const none = new Float32Array(0);
    const rects: number[][] = [];
    for (let i = 0; i < 2; i++) {
      edgePin(3000, 400, 210, 52, AREA, 0, pin);
      const slot: BubbleSlot = { ax: pin.cx, ay: pin.cy + 26, w: 210, h: 52, maxShift: 240, prevDx: NaN, prevDy: NaN };
      for (let k = 0; k < rects.length; k++) hard.set(rects[k]!, k * 4);
      expect(placeBubble(slot, AREA, hard, rects.length, none, 0, none, 0, out)).toBe(true);
      const l = slot.ax + out.dx - 105, r = l + 210, b = slot.ay + out.dy, t = b - 52;
      expect(l).toBeGreaterThanOrEqual(AREA.minL - 0.5); expect(r).toBeLessThanOrEqual(AREA.maxR + 0.5);
      expect(t).toBeGreaterThanOrEqual(AREA.minT - 0.5); expect(b).toBeLessThanOrEqual(AREA.maxB + 0.5);
      for (const q of rects) expect(r <= q[0]! || l >= q[1]! || b <= q[2]! || t >= q[3]!).toBe(true);
      rects.push([l, r, t, b]);
    }
  });
});

describe('raid chip', () => {
  it('shows one fixed number per raid: the announced size, never below the avatars seen, never +0', () => {
    expect(raidChipCount(40, 9)).toBe(40);
    expect(raidChipCount(40, 14)).toBe(40);
    expect(raidChipCount(undefined, 5)).toBe(5);
    expect(raidChipCount(2, 3)).toBe(3);
    expect(raidChipCount('lots', 0)).toBe(0);
    expect(raidChipText(40, 'CozyStreamer')).toBe('+40 raiders from CozyStreamer');
    expect(raidChipText(0, 'CozyStreamer')).toBe('');
  });

  it('anchors at the densest cluster and keeps its anchor unless another cluster is 2+ bigger', () => {
    // Sub-group A (4 close together) and B (3 close together), 20 m apart.
    const xs = [0, 1, 0, 1, 20, 21, 20], zs = [0, 0, 1, 1, 0, 0, 1];
    const o = { count: 0 };
    const a = densestMember(xs, zs, 7, 7, -1, o);
    expect(a).toBeLessThan(4); expect(o.count).toBe(4);
    // Previous anchor in B (3) vs best A (4): within 1 → keep B (no hopping).
    expect(densestMember(xs, zs, 7, 7, 5, o)).toBe(5); expect(o.count).toBe(3);
    // B shrinks to a single member far away: switch to A.
    const xs2 = [0, 1, 0, 1, 20, 60, 90];
    expect(densestMember(xs2, zs, 7, 7, 4, o)).toBeLessThan(4);
    expect(densestMember(xs, zs, 0, 7, -1, o)).toBe(-1);
  });
});
