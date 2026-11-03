/**
 * Speech-bubble placement (Node-safe, allocation-free). A bubble box hangs above its anchor (the tail
 * tip over the speaker's head): box = [ax+dx-w/2, ax+dx+w/2] × [ay+dy-h, ay+dy], dy ≤ 0, |dx| ≤ maxShift
 * (the tail stays under the box). `placeBubble` searches side shifts × lifts and picks the cheapest
 * placement that stays inside the safe area and clear of every HARD rect (HUD pills, banner, inspector,
 * already placed bubbles, protected nameplates — viewer / selected / raid chips). SOFT rects (other
 * nameplates) and leader lines cost extra, so they are avoided whenever there is room.
 *
 * Rects are packed in Float32Arrays as [left, right, top, bottom] × n (client px).
 */

export interface BubbleSlot {
  /** Anchor (tail tip) in px. */
  ax: number; ay: number;
  /** On-screen (scaled) box size in px. */
  w: number; h: number;
  /** Max |dx| (box centre vs anchor) so the tail still sits under the box. */
  maxShift: number;
  /** Previous placement (stability bias); NaN = none. */
  prevDx: number; prevDy: number;
}

export interface SafeArea { minL: number; maxR: number; minT: number; maxB: number }

export interface Placement { dx: number; dy: number; cost: number; softHits: number }

/** Clearance (px) kept between a bubble and any hard rect. */
export const BUBBLE_GAP = 6;
/** Half width (px) of the tail / leader line footprint under a bubble. */
const STEM_HALF = 6;
const COST_DX = 1.2;
const COST_DY = 1;
const COST_SOFT = 400;
const COST_STEM_BUBBLE = 250;
const COST_STEM_SOFT = 40;
const COST_COVER_STEM = 250;
const COST_JUMP = 0.35;
/** Upper bounds on candidate offsets considered per axis. */
const MAX_CAND = 24;

const candDx = new Float32Array(MAX_CAND);
const candDy = new Float32Array(MAX_CAND);

export function overlaps(l: number, r: number, t: number, b: number, rects: Float32Array, k: number, pad = 0): boolean {
  const o = k * 4;
  return r > rects[o]! - pad && l < rects[o + 1]! + pad && b > rects[o + 2]! - pad && t < rects[o + 3]! + pad;
}

function pushUnique(arr: Float32Array, n: number, v: number): number {
  if (n >= MAX_CAND) return n;
  for (let i = 0; i < n; i++) if (Math.abs(arr[i]! - v) < 0.5) return n;
  arr[n] = v;
  return n + 1;
}

/**
 * Cheapest valid placement for `slot`, or false when none exists (caller collapses the bubble).
 * `stems` are leader-line rects of bubbles placed earlier (a new box should not cover them).
 */
export function placeBubble(
  slot: BubbleSlot, area: SafeArea,
  hard: Float32Array, nHard: number,
  soft: Float32Array, nSoft: number,
  stems: Float32Array, nStems: number,
  out: Placement,
): boolean {
  const { ax, ay, w, h, maxShift } = slot;
  const hw = w / 2, g = BUBBLE_GAP;
  // Region a placement can reach: obstacles outside it are irrelevant.
  const reachL = ax - maxShift - hw - g, reachR = ax + maxShift + hw + g, reachB = ay + g;
  // dx candidates: centred, clamped into the safe area, previous, and flush beside each nearby obstacle.
  let nx = 0;
  const clampDx = (dx: number) => {
    const l = ax + dx - hw, r = ax + dx + hw;
    return l < area.minL ? dx + (area.minL - l) : r > area.maxR ? dx - (r - area.maxR) : dx;
  };
  nx = pushUnique(candDx, nx, clampDx(0));
  if (slot.prevDx === slot.prevDx) nx = pushUnique(candDx, nx, slot.prevDx);
  let ny = 0;
  ny = pushUnique(candDy, ny, 0);
  if (slot.prevDy === slot.prevDy && slot.prevDy <= 0) ny = pushUnique(candDy, ny, slot.prevDy);
  for (let pass = 0; pass < 2; pass++) {
    const rects = pass === 0 ? hard : soft, n = pass === 0 ? nHard : nSoft;
    for (let k = 0; k < n; k++) {
      const o = k * 4;
      const l = rects[o]!, r = rects[o + 1]!, t = rects[o + 2]!, b = rects[o + 3]!;
      if (r < reachL || l > reachR || t > reachB) continue;
      nx = pushUnique(candDx, nx, l - g - (ax + hw));   // box right edge just left of it
      nx = pushUnique(candDx, nx, r + g - (ax - hw));   // box left edge just right of it
      const dy = t - g - ay;                             // box bottom just above it
      if (dy < 0) ny = pushUnique(candDy, ny, dy);
      if (b < ay) {
        // Under it (between it and the head) when it floats higher up.
        const dyUnder = Math.min(0, b + g + h - ay);
        if (dyUnder <= 0) ny = pushUnique(candDy, ny, dyUnder);
      }
    }
  }
  let best = Infinity, bestDx = 0, bestDy = 0, bestSoft = 0;
  for (let i = 0; i < nx; i++) {
    const dx = candDx[i]!;
    if (Math.abs(dx) > maxShift + 0.5) continue;
    const l = ax + dx - hw, r = ax + dx + hw;
    if (l < area.minL - 0.5 || r > area.maxR + 0.5) continue;
    for (let j = 0; j < ny; j++) {
      const dy = candDy[j]!;
      const b = ay + dy, t = b - h;
      if (t < area.minT - 0.5 || b > area.maxB + 0.5) continue;
      let cost = Math.abs(dx) * COST_DX + Math.abs(dy) * COST_DY;
      if (slot.prevDx === slot.prevDx) cost += (Math.abs(dx - slot.prevDx) + Math.abs(dy - slot.prevDy)) * COST_JUMP;
      if (cost >= best) continue;
      let ok = true;
      for (let k = 0; k < nHard && ok; k++) if (overlaps(l, r, t, b, hard, k, g - 0.01)) ok = false;
      if (!ok) continue;
      // Leader line / tail: from the box bottom down to the anchor (+ the tail tip under it).
      const sl = ax - STEM_HALF, sr = ax + STEM_HALF, st = b, sb = ay + 8;
      let softHits = 0;
      for (let k = 0; k < nSoft; k++) {
        if (overlaps(l, r, t, b, soft, k, 1)) { softHits++; cost += COST_SOFT; }
        else if (overlaps(sl, sr, st, sb, soft, k)) cost += COST_STEM_SOFT;
      }
      for (let k = 0; k < nHard; k++) if (overlaps(sl, sr, st + 1, sb, hard, k)) cost += COST_STEM_BUBBLE;
      for (let k = 0; k < nStems; k++) if (overlaps(l, r, t, b, stems, k)) cost += COST_COVER_STEM;
      if (cost < best) { best = cost; bestDx = dx; bestDy = dy; bestSoft = softHits; }
    }
  }
  if (best === Infinity) return false;
  out.dx = bestDx; out.dy = bestDy; out.cost = best; out.softHits = bestSoft;
  return true;
}
