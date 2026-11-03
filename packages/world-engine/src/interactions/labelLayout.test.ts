/**
 * Nameplate occlusion (fountain / stage / portal / buildings / tagged props) and speech-bubble
 * placement (no bubble–bubble overlap, nameplates avoided, safe area kept). Pure, runs in Node.
 */
import { describe, expect, it } from 'vitest';
import { BUILDINGS, getPoi } from '../world/layout';
import type { CameraProp } from '../scene/cameraPose';
import { labelSightBlocked, PORTAL_LABEL_OCCLUDERS, WORLD_LABEL_OCCLUDERS } from './labelOcclusion';
import { BUBBLE_GAP, placeBubble, type BubbleSlot, type Placement, type SafeArea } from './bubbleLayout';

const W = WORLD_LABEL_OCCLUDERS;

describe('label occlusion', () => {
  it('hides a label behind the fountain tiers, not one in front of or beside it', () => {
    // Neighbourhood-like camera south of the plaza, looking north.
    const cam = [0, 9, 16] as const;
    expect(labelSightBlocked(...cam, 0, 1.6, -1.9, W, null)).toBe(true);   // seated on the far rim
    expect(labelSightBlocked(...cam, 0, 2.1, 3.2, W, null)).toBe(false);   // in front of the basin
    expect(labelSightBlocked(...cam, 5, 2.1, -1.9, W, null)).toBe(false);  // off to the side
  });

  it('hides labels behind the portal ring but not beside it or of a raider standing in it', () => {
    const p = getPoi('portal')!.position;
    const cam = [p.x, 4, p.z + 12] as const;
    expect(labelSightBlocked(...cam, p.x + 0.8, 2.1, p.z - 2.5, W, null)).toBe(true);
    expect(labelSightBlocked(...cam, p.x + 7, 2.1, p.z - 2.5, W, null)).toBe(false);
    expect(labelSightBlocked(...cam, p.x, 2.1, p.z, W, null)).toBe(false);
    // Overlay set: only the portal.
    expect(labelSightBlocked(...cam, p.x + 0.8, 2.1, p.z - 2.5, PORTAL_LABEL_OCCLUDERS, null)).toBe(true);
    expect(labelSightBlocked(0, 9, 16, 0, 1.6, -1.9, PORTAL_LABEL_OCCLUDERS, null)).toBe(false);
  });

  it('keeps building occlusion', () => {
    const b = BUILDINGS.find(x => x.kind === 'cafe')!;
    // From the plaza side through the café to a point right behind it.
    const dirX = b.position.x - 0, dirZ = b.position.z - 0;
    const L = Math.hypot(dirX, dirZ);
    const behind = [b.position.x + (dirX / L) * 4.5, 2.1, b.position.z + (dirZ / L) * 4.5] as const;
    expect(labelSightBlocked(0, 3, 0, ...behind, W, null)).toBe(true);
  });

  it('uses tagged props: canopies hide, thin posts and the space under an umbrella do not', () => {
    const tree: CameraProp = { x: 10, z: 0, r: 1.5, h: 4.3 };
    const lamp: CameraProp = { x: 10, z: 0, r: 0.3, h: 4.1 };
    const umbrella: CameraProp = { x: 10, z: 0, r: 1.5, h: 2.8, minY: 2.0 };
    // High camera looking down through the canopy at a label just behind the tree.
    expect(labelSightBlocked(20, 8, 0, 9, 2.1, 0, W, [tree])).toBe(true);
    expect(labelSightBlocked(20, 8, 0, 9, 2.1, 0, W, [lamp])).toBe(false);
    // Low (street) camera: sight line under the umbrella canopy to a seated label.
    expect(labelSightBlocked(16, 1.6, 0, 7, 1.5, 0, W, [umbrella])).toBe(false);
    // Same label seen from above through the umbrella canopy.
    expect(labelSightBlocked(16, 9, 0, 10.2, 1.5, 0, W, [umbrella])).toBe(true);
    // A canopy without minY does not hide a label seen under it from eye level (trunk is thin).
    expect(labelSightBlocked(16, 0.9, 0, 4, 0.9, 0, W, [tree])).toBe(false);
  });
});

const AREA: SafeArea = { minL: 12, maxR: 948, minT: 12, maxB: 528 };
const out: Placement = { dx: 0, dy: 0, cost: 0, softHits: 0 };
const slot = (ax: number, ay: number, w = 180, h = 54): BubbleSlot => ({ ax, ay, w, h, maxShift: w / 2 - 18, prevDx: NaN, prevDy: NaN });
const pushRect = (arr: Float32Array, n: number, l: number, r: number, t: number, b: number) => { arr.set([l, r, t, b], n * 4); return n + 1; };
const ov = (a: number[], b: number[]) => a[1]! > b[0]! && a[0]! < b[1]! && a[3]! > b[2]! && a[2]! < b[3]!;

describe('bubble placement', () => {
  it('stacks bubbles with the same anchor without overlap', () => {
    const hard = new Float32Array(64), soft = new Float32Array(64), stems = new Float32Array(64);
    let nh = 0;
    const boxes: number[][] = [];
    for (let i = 0; i < 3; i++) {
      const s = slot(480, 300);
      expect(placeBubble(s, AREA, hard, nh, soft, 0, stems, 0, out)).toBe(true);
      const box = [s.ax + out.dx - s.w / 2, s.ax + out.dx + s.w / 2, s.ay + out.dy - s.h, s.ay + out.dy];
      for (const b of boxes) expect(ov(box, b)).toBe(false);
      boxes.push(box);
      nh = pushRect(hard, nh, box[0]!, box[1]!, box[2]!, box[3]!);
    }
  });

  it('steers around a nameplate when there is room and never covers a protected one', () => {
    const hard = new Float32Array(64), soft = new Float32Array(64), stems = new Float32Array(64);
    // A neighbour's nameplate right where the bubble would sit.
    const nSoft = pushRect(soft, 0, 440, 520, 270, 292);
    const s = slot(480, 300);
    expect(placeBubble(s, AREA, hard, 0, soft, nSoft, stems, 0, out)).toBe(true);
    expect(out.softHits).toBe(0);
    // Same rect as a protected (hard) plate: must be clear by the gap.
    const nh = pushRect(hard, 0, 440, 520, 270, 292);
    expect(placeBubble(s, AREA, hard, nh, soft, 0, stems, 0, out)).toBe(true);
    const box = [s.ax + out.dx - s.w / 2 - BUBBLE_GAP + 0.1, s.ax + out.dx + s.w / 2 + BUBBLE_GAP - 0.1, s.ay + out.dy - s.h - BUBBLE_GAP + 0.1, s.ay + out.dy + BUBBLE_GAP - 0.1];
    expect(ov(box, [440, 520, 270, 292])).toBe(false);
  });

  it('collapses (returns false) when there is no room inside the safe area', () => {
    const hard = new Float32Array(64), soft = new Float32Array(64), stems = new Float32Array(64);
    const nh = pushRect(hard, 0, 0, 960, 0, 400);
    expect(placeBubble(slot(480, 300), AREA, hard, nh, soft, 0, stems, 0, out)).toBe(false);
  });

  it('fuzz: sequentially placed bubbles never overlap each other or protected plates and stay in the safe area', () => {
    let seed = 1234567;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
    for (let trial = 0; trial < 300; trial++) {
      const hard = new Float32Array(4 * 40), soft = new Float32Array(4 * 40), stems = new Float32Array(4 * 40);
      let nh = 0, ns = 0, nst = 0;
      const protectedPlates: number[][] = [];
      for (let k = 0; k < 2; k++) {
        const x = 60 + rnd() * 840, y = 80 + rnd() * 420, w = 50 + rnd() * 60;
        const r = [x - w / 2, x + w / 2, y - 11, y + 11];
        protectedPlates.push(r); nh = pushRect(hard, nh, r[0]!, r[1]!, r[2]!, r[3]!);
      }
      for (let k = 0; k < 6; k++) { const x = 60 + rnd() * 840, y = 80 + rnd() * 420; ns = pushRect(soft, ns, x - 35, x + 35, y - 11, y + 11); }
      const boxes: number[][] = [];
      const n = 2 + Math.floor(rnd() * 6);
      for (let i = 0; i < n; i++) {
        // Clustered anchors (a conversation) to force conflicts.
        const s = slot(380 + rnd() * 200, 220 + rnd() * 160, 110 + rnd() * 120, 40 + rnd() * 30);
        if (!placeBubble(s, AREA, hard, nh, soft, ns, stems, nst, out)) continue;
        const box = [s.ax + out.dx - s.w / 2, s.ax + out.dx + s.w / 2, s.ay + out.dy - s.h, s.ay + out.dy];
        expect(box[0]!).toBeGreaterThanOrEqual(AREA.minL - 0.5);
        expect(box[1]!).toBeLessThanOrEqual(AREA.maxR + 0.5);
        expect(box[2]!).toBeGreaterThanOrEqual(AREA.minT - 0.5);
        expect(Math.abs(out.dx)).toBeLessThanOrEqual(s.maxShift + 0.5);
        expect(out.dy).toBeLessThanOrEqual(0);
        for (const b of boxes) expect(ov(box, b)).toBe(false);
        for (const p of protectedPlates) expect(ov(box, p)).toBe(false);
        boxes.push(box);
        nh = pushRect(hard, nh, box[0]!, box[1]!, box[2]!, box[3]!);
        nst = pushRect(stems, nst, s.ax - 6, s.ax + 6, box[3]!, s.ay + 8);
      }
    }
  });
});
