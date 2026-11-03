/**
 * Camera pose picker: a resident seated at the Plaza Bench must never be framed through a lamp post
 * (or any tall prop in the central third), for every heading; and clutter is rejected even right
 * next to the subject (no near-subject exemption).
 */
import { describe, expect, it } from 'vitest';
import { getPoi, POIS } from '../world/layout';
import { buildTown } from './town';
import { centralClutter, pickFramingPose, segmentHitsProp, setCameraProps, type PickedPose } from './cameraPose';

const town = buildTown('low', { horizon: false });
const lampPosts = town.occluders.filter(o => Math.abs(o.r - 0.3) < 1e-6 && Math.abs(o.h - 4.1) < 1e-6); // lamp posts (see addLamp)

describe('camera pose picker', () => {
  it('keeps lamp posts ≥ 2.4 m from every seat, with lamp posts still around the Plaza Bench', () => {
    const seat = getPoi('bench-plaza-w')!.seats![0]!;
    expect(lampPosts.length).toBeGreaterThan(5);
    expect(lampPosts.some(l => Math.hypot(l.x - seat.x, l.z - seat.z) < 9)).toBe(true);
    for (const st of POIS.flatMap(p => p.seats ?? [])) {
      for (const l of lampPosts) expect(Math.hypot(l.x - st.x, l.z - st.z)).toBeGreaterThanOrEqual(2.4);
    }
  });

  it('frames a seated resident at the Plaza Bench without a lamp post on the camera→head segment', () => {
    setCameraProps(town.occluders);
    const bench = getPoi('bench-plaza-w')!;
    for (const seat of bench.seats!) {
      for (let i = 0; i < 12; i++) {
        const heading = (i / 12) * Math.PI * 2;
        const pose: PickedPose = { x: 0, y: 0, z: 0, yaw: 0, rel: 0.62, level: 0 };
        const headY = 1.25; // seated head height
        const ok = pickFramingPose(seat.x, seat.z, headY, heading, 6.8, 3.1, pose);
        expect(ok).toBe(true);
        for (const lamp of lampPosts) {
          expect(segmentHitsProp(pose.x, pose.y, pose.z, seat.x, headY, seat.z, lamp, 0.35)).toBe(false);
        }
        expect(centralClutter(pose.x, pose.y, pose.z, seat.x, headY, seat.z)).toBe(false);
      }
    }
  });

  it('counts a lamp post right beside the subject as clutter (no near-subject exemption)', () => {
    setCameraProps([{ x: 0.6, z: 0.8, r: 0.3, h: 4.1 }]);
    // camera 7 m south (+z) of a subject at the origin; lamp 0.8 m in front of the subject (towards the camera), 0.6 m to the side
    expect(centralClutter(0, 3.1, 7, 0, 1.25, 0)).toBe(true);
    // a lamp 0.8 m behind the subject, in line with the head, grows out of it → clutter too
    expect(centralClutter(0, 3.1, -7, 0.0, 1.25, 0.0)).toBe(true);
    // seen from the west the lamp stands clear behind-and-beside the subject → fine
    expect(centralClutter(-7, 3.1, 0, 0, 1.25, 0)).toBe(false);
  });
});

import * as THREE from 'three';
import { BUILDINGS } from '../world/layout';
import {
  LAYOUT_PROPS, blocked, fitPointsToView, lensClear, pickTwoShot, poseClean, projectedPx, pushBackToFit, wallCoverage,
  WALL_COVERAGE_MAX, type ViewFit,
} from './cameraPose';

const STAGE = getPoi('stage')!.position;
const cam = (x: number, y: number, z: number, lx: number, ly: number, lz: number, aspect = 16 / 9) => {
  const c = new THREE.PerspectiveCamera(42, aspect, 0.1, 500);
  c.position.set(x, y, z); c.lookAt(lx, ly, lz); c.updateMatrixWorld(); c.updateProjectionMatrix();
  return c;
};
const ndc = (c: THREE.Camera, x: number, y: number, z: number) => new THREE.Vector3(x, y, z).project(c);

describe('camera clutter: stage rigging, planters, claw machine, fences, walls', () => {
  it('publishes layout props the town builder does not (stage span, portal sides, terrace planters, arcade cabinets, yard fences)', () => {
    expect(LAYOUT_PROPS.some(p => p.canopy && Math.hypot(p.x - STAGE.x, p.z - STAGE.z) < 0.01)).toBe(true);
    const arcade = BUILDINGS.find(b => b.kind === 'arcade')!;
    expect(LAYOUT_PROPS.filter(p => Math.abs(p.h - 1.9) < 1e-6 && Math.hypot(p.x - arcade.position.x, p.z - arcade.position.z) < 6).length).toBe(2);
    expect(LAYOUT_PROPS.filter(p => Math.abs(p.h - 1.0) < 1e-6).length).toBeGreaterThan(20); // picket fences
    expect(LAYOUT_PROPS.filter(p => Math.abs(p.z - getPoi('portal')!.position.z) < 0.01).length).toBe(2);
  });

  it('never looks down through the string-light span at a resident on the stage; a low pose passes under it', () => {
    setCameraProps(town.occluders);
    const headY = 2.0; // standing on the 0.45 m stage
    // K-cinematic-b: high orbit pose (h 7.6 at 9.4 m) → through the strings
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      expect(blocked(STAGE.x + Math.sin(a) * 9.4, 7.6, STAGE.z + Math.cos(a) * 9.4, STAGE.x, headY, STAGE.z)).toBe(true);
    }
    // low orbit (h 2.05 at 6.6 m) passes under the span from at least some yaws, and those are fully clean
    let clean = 0;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      if (poseClean(STAGE.x + Math.sin(a) * 6.6, 2.05, STAGE.z + Math.cos(a) * 6.6, STAGE.x, 1.55, STAGE.z)) clean++;
    }
    expect(clean).toBeGreaterThan(0);
  });

  it('rejects a planter tree / prop right beside the lens anywhere in the frame (K-street)', () => {
    setCameraProps([{ x: -1.5, z: -1.0, r: 0.93, h: 2.67 }]);
    // camera at the origin at eye level looking down -z: the planter sits at the left edge, 1 m ahead
    expect(lensClear(0, 1.75, 0, 0, -9)).toBe(false);
    // same prop 6 m away is not a lens problem
    setCameraProps([{ x: -1.5, z: -6.0, r: 0.93, h: 2.67 }]);
    expect(lensClear(0, 1.75, 0, 0, -9)).toBe(true);
    // a low yard fence 1.5 m ahead of a low camera also fills the bottom of the frame
    setCameraProps([{ x: 0.3, z: -1.5, r: 0.45, h: 1.0 }]);
    expect(lensClear(0, 1.8, 0, 0, -9)).toBe(false);
  });

  it('rejects a near building wall covering a large part of the frame (K-follow-seated), not a backdrop', () => {
    setCameraProps(town.occluders);
    const arcade = BUILDINGS.find(b => b.kind === 'arcade')!;
    const c = Math.cos(arcade.rotation), s = Math.sin(arcade.rotation);
    const w = (lx: number, lz: number) => ({ x: arcade.position.x + lx * c + lz * s, z: arcade.position.z - lx * s + lz * c });
    // subject in front of the right cabinet, camera beside the wall line looking along it
    const subj = w(2.4, arcade.depth / 2 + 1.4);
    const camP = w(arcade.width / 2 + 2.6, arcade.depth / 2 + 7.5);
    expect(wallCoverage(camP.x, 3.1, camP.z, subj.x, subj.z)).toBeGreaterThan(WALL_COVERAGE_MAX);
    // the same facade straight behind the subject is a backdrop (does not count)
    const front = w(0, arcade.depth / 2 + 8);
    expect(wallCoverage(front.x, 3.1, front.z, w(0, arcade.depth / 2 + 1.2).x, w(0, arcade.depth / 2 + 1.2).z)).toBeLessThanOrEqual(WALL_COVERAGE_MAX);
    // the picker finds wall-free, clutter-free poses for a resident at the arcade for every heading
    const poi = getPoi('arcade')!.position;
    for (let i = 0; i < 12; i++) {
      const pose: PickedPose = { x: 0, y: 0, z: 0, yaw: 0, rel: 0.62, level: 0 };
      if (pickFramingPose(poi.x, poi.z, 1.6, (i / 12) * Math.PI * 2, 6.8, 3.1, pose)) {
        expect(wallCoverage(pose.x, pose.y, pose.z, poi.x, poi.z)).toBeLessThanOrEqual(WALL_COVERAGE_MAX);
      }
    }
  });
});

describe('two-shot + overlay fits', () => {
  it('two-shot keeps actor and target inside the central 60 % of a 16:9 frame', () => {
    setCameraProps(town.occluders);
    const pairs: Array<[number, number, number, number]> = [[-3, 5.5, 0.5, 6.5], [9, -3, 12, -7], [-6, -2, -9, -6], [-7.9, 2.9, -5.2, 5.6], [2, 9, 5, 11]];
    for (let i = 0; i < pairs.length; i++) {
      const [ax, az, bx, bz] = pairs[i]!;
      const out = { x: 0, y: 0, z: 0, yaw: 0, rel: 1, level: 0, dist: 0 };
      const ok = pickTwoShot(ax, az, bx, bz, 1.55, 3.0, 7, 1, out);
      // the last pair stands in the prop-dense strip by the stage bench: no clean two-shot may exist there
      // (the rig then falls back to a front three-quarter on the actor) — but a returned pose must hold
      if (i < pairs.length - 1) expect(ok).toBe(true);
      if (!ok) continue;
      const c = cam(out.x, out.y, out.z, (ax + bx) / 2, 1.1, (az + bz) / 2);
      for (const [x, z] of [[ax, az], [bx, bz]] as const) {
        for (const y of [0.3, 1.5]) {
          const p = ndc(c, x, y, z);
          expect(Math.abs(p.x)).toBeLessThanOrEqual(0.62);
          expect(Math.abs(p.y)).toBeLessThanOrEqual(0.8);
        }
      }
    }
  });

  const box = (pts: number[], x: number, z: number, half: number, top: number) => {
    for (let m = 0; m < 8; m++) pts.push(m & 1 ? x + half : x - half, m & 2 ? top : 0, m & 4 ? z + half : z - half);
  };

  it('overlay event fit: a two-resident gift shot shows both ≥ 90 px tall at 720p and never outside NDC ±0.82', () => {
    const pts: number[] = [];
    box(pts, 4, 2, 0.55, 2.4); box(pts, 7, 3.5, 0.55, 2.4);
    const el = 0.36, yaw = 0.4;
    const b = new THREE.Vector3(Math.sin(yaw) * Math.cos(el), Math.sin(el), Math.cos(yaw) * Math.cos(el));
    const tanV = Math.tan(THREE.MathUtils.degToRad(21));
    const fit: ViewFit = { x: 0, y: 0, z: 0, depth: 0 };
    fitPointsToView(pts, pts.length / 3, b.x, b.y, b.z, tanV, 16 / 9, 0.82, 9.5, 0.6, fit);
    const c = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 500);
    c.position.set(fit.x, fit.y, fit.z); c.lookAt(fit.x - b.x, fit.y - b.y, fit.z - b.z); c.updateMatrixWorld();
    for (let i = 0; i < pts.length; i += 3) {
      const p = ndc(c, pts[i]!, pts[i + 1]!, pts[i + 2]!);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(0.8201);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(0.8201);
    }
    for (const [x, z] of [[4, 2], [7, 3.5]] as const) {
      const feet = ndc(c, x, 0, z), head = ndc(c, x, 1.6, z);
      const px = ((head.y - feet.y) / 2) * 720;
      expect(px).toBeGreaterThanOrEqual(90);
    }
    expect(projectedPx(1.6, fit.depth, tanV, 720)).toBeGreaterThanOrEqual(90);
    // the fit is tight: some point touches the safe margin
    let maxAbs = 0;
    for (let i = 0; i < pts.length; i += 3) { const p = ndc(c, pts[i]!, pts[i + 1]!, pts[i + 2]!); maxAbs = Math.max(maxAbs, Math.abs(p.x), Math.abs(p.y)); }
    expect(maxAbs).toBeGreaterThan(0.5);
  });

  it('steady overlay fit: everyone inside NDC ±0.82, and pushBackToFit restores the guarantee for a lagging camera', () => {
    const pts: number[] = [];
    const spots: Array<[number, number]> = [[-7.6, 3.4], [3.2, 8.6], [12.5, -6.5], [-15, -15], [0, 0], [7.5, 7], [17.5, -16.5]];
    for (const [x, z] of spots) box(pts, x, z, 0.7, 2.9);
    const b = new THREE.Vector3(0, 0.58, 1).normalize();
    const tanV = Math.tan(THREE.MathUtils.degToRad(21));
    const fit: ViewFit = { x: 0, y: 0, z: 0, depth: 0 };
    fitPointsToView(pts, pts.length / 3, b.x, b.y, b.z, tanV, 16 / 9, 0.82, 0, 0.6, fit);
    const c = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 500);
    const place = (x: number, y: number, z: number) => { c.position.set(x, y, z); c.lookAt(x - b.x, y - b.y, z - b.z); c.updateMatrixWorld(); };
    place(fit.x, fit.y, fit.z);
    for (let i = 0; i < pts.length; i += 3) {
      const p = ndc(c, pts[i]!, pts[i + 1]!, pts[i + 2]!);
      expect(Math.max(Math.abs(p.x), Math.abs(p.y))).toBeLessThanOrEqual(0.8201);
    }
    // a camera 6 m too close: the push-back puts everything back inside
    const nx = fit.x - b.x * 6, ny = fit.y - b.y * 6, nz = fit.z - b.z * 6;
    const push = pushBackToFit(pts, pts.length / 3, nx, ny, nz, b.x, b.y, b.z, tanV, 16 / 9, 0.82, 0.6);
    expect(push).toBeGreaterThan(5.9);
    place(nx + b.x * push, ny + b.y * push, nz + b.z * push);
    for (let i = 0; i < pts.length; i += 3) {
      const p = ndc(c, pts[i]!, pts[i + 1]!, pts[i + 2]!);
      expect(Math.max(Math.abs(p.x), Math.abs(p.y))).toBeLessThanOrEqual(0.8201);
    }
  });
});

import {
  guardFraming, newTwoBeat, startTwoBeat, stepTwoBeat, TWO_BEAT, STREET_CANOPY_REACH, projectNdc,
} from './cameraPose';

describe('two-beat event shot (gift / greet with a far target)', () => {
  it('opens on the actor, follows the approach, cuts to the two-shot in range and holds it once both are in frame', () => {
    const b = newTwoBeat();
    // giver 24 m away jogging at 3 m/s; the target waits
    expect(startTwoBeat(b, 0, 24)).toBe('actor');
    const phases: string[] = [];
    let twoAt = NaN, doneAt = NaN;
    for (let t = 0.1; t < 20; t += 0.1) {
      const sep = Math.max(1.1, 24 - 3 * t);
      const ph = stepTwoBeat(b, t, sep, t - (Number.isNaN(twoAt) ? 1e9 : twoAt) > 0.6); // in frame 0.6 s after the cut
      phases.push(ph);
      if (ph === 'two' && Number.isNaN(twoAt)) { twoAt = t; expect(sep).toBeLessThanOrEqual(TWO_BEAT.range); expect(b.wide).toBe(false); }
      if (ph === 'done') { doneAt = t; break; }
    }
    expect(twoAt).toBeGreaterThanOrEqual(TWO_BEAT.minActor);   // the giver is on screen first
    expect(doneAt - (twoAt + 0.6)).toBeGreaterThanOrEqual(1.5); // pair held ≥ 1.5 s after both are in frame
  });

  it('a pair that never gets close still ends on a wide two-shot (never on one of them alone)', () => {
    const b = newTwoBeat();
    startTwoBeat(b, 0, 22);
    let ph = 'actor', t = 0;
    while (ph === 'actor' && t < 20) { t += 0.1; ph = stepTwoBeat(b, t, 22, false); }
    expect(ph).toBe('two');
    expect(b.wide).toBe(true);
    expect(t).toBeLessThanOrEqual(TWO_BEAT.minActor + 0.5 + TWO_BEAT.stall + 0.11); // stalled → wide two-shot
    // they meet during the wide shot → tighten
    stepTwoBeat(b, t + 0.1, 3, true);
    expect(b.wide).toBe(false);
  });

  it('a pair already within range opens straight on the two-shot; it gives up if never in frame', () => {
    const b = newTwoBeat();
    expect(startTwoBeat(b, 5, 4)).toBe('two');
    expect(stepTwoBeat(b, 5 + TWO_BEAT.giveUp - 0.1, 4, false)).toBe('two');
    expect(stepTwoBeat(b, 5 + TWO_BEAT.giveUp + 0.01, 4, false)).toBe('done');
  });
});

describe('follow framing guard', () => {
  const tanV = Math.tan(THREE.MathUtils.degToRad(21));
  const check = (pos: { x: number; y: number; z: number }, look: { x: number; y: number; z: number }, sx: number, sz: number) => {
    const c = cam(pos.x, pos.y, pos.z, look.x, look.y, look.z);
    for (const y of [0.05, 1.75]) {
      const p = ndc(c, sx, y, sz);
      expect(p.z).toBeLessThan(1);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(0.8);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(0.8);
    }
  };
  it('projectNdc matches three.js projection', () => {
    const c = cam(3, 4, 9, 0, 1, 0);
    const o = { x: 0, y: 0, z: 0 };
    for (const [x, y, z] of [[0, 0, 0], [1, 1.7, -1], [-2, 0.3, 2]] as const) {
      projectNdc({ x: 3, y: 4, z: 9 }, { x: 0, y: 1, z: 0 }, x, y, z, tanV, 16 / 9, o);
      const p = ndc(c, x, y, z);
      expect(o.x).toBeCloseTo(p.x, 4); expect(o.y).toBeCloseTo(p.y, 4);
    }
  });
  it('re-aims a look-ahead pose that lost the seated subject (K-follow-seated) and keeps head + feet inside ±0.8', () => {
    // camera 6.8 m out at 3.1 m, but the look-ahead aims 5 m beside the subject: the body leaves the frame
    const pos = { x: 6.8, y: 3.1, z: 0 }, look = { x: 0, y: 1.15, z: 5 };
    const before = projectNdc(pos, look, 0, 0.05, 0, tanV, 16 / 9, { x: 0, y: 0, z: 0 });
    expect(Math.abs(before.x)).toBeGreaterThan(0.8);
    expect(guardFraming(pos, look, 0, 0, 1.75, tanV, 16 / 9)).toBeGreaterThan(0);
    check(pos, look, 0, 0);
  });
  it('pulls back a pose too close to fit the body and enforces the minimum down-angle', () => {
    const pos = { x: 1.2, y: 1.2, z: 0.2 }, look = { x: 0, y: 1.1, z: 0 };
    expect(guardFraming(pos, look, 0, 0, 1.75, tanV, 16 / 9, 0.8, THREE.MathUtils.degToRad(16))).toBe(2);
    check(pos, look, 0, 0);
    const hd = Math.hypot(pos.x, pos.z);
    expect((pos.y - 1.085) / hd).toBeGreaterThanOrEqual(Math.tan(THREE.MathUtils.degToRad(16)) - 1e-9);
    // an already good pose is untouched
    const p2 = { x: 0, y: 3.1, z: 6.8 }, l2 = { x: 0, y: 1.15, z: 0 };
    expect(guardFraming(p2, l2, 0, 0, 1.75, tanV, 16 / 9)).toBe(0);
    expect(p2).toEqual({ x: 0, y: 3.1, z: 6.8 });
  });
  it('a high camera looking down past a near wall still counts the wall (K-follow-later)', () => {
    setCameraProps(town.occluders);
    const arcade = BUILDINGS.find(b => b.kind === 'arcade')!;
    const c = Math.cos(arcade.rotation), s = Math.sin(arcade.rotation);
    const w = (lx: number, lz: number) => ({ x: arcade.position.x + lx * c + lz * s, z: arcade.position.z - lx * s + lz * c });
    const subj = w(2.4, arcade.depth / 2 + 1.4);
    const camP = w(arcade.width / 2 + 2.6, arcade.depth / 2 + 7.5);
    expect(wallCoverage(camP.x, 8.1, camP.z, subj.x, subj.z)).toBeGreaterThan(WALL_COVERAGE_MAX);
  });
});

describe('street canopy + overlay band', () => {
  it('rejects a planter tree 5 m from an eye-level street lens (K-street) only with the street reach', () => {
    setCameraProps([{ x: -3.6, z: -7.6, r: 0.93, h: 2.67 }]);
    // K-street camera (0.1, 1.9, -4.1) looking towards the café side
    expect(lensClear(0.1, 1.9, -4.1, -6, -10)).toBe(true);
    expect(lensClear(0.1, 1.9, -4.1, -6, -10, STREET_CANOPY_REACH)).toBe(false);
    // a thin lamp post at the same spot is not a canopy
    setCameraProps([{ x: -3.6, z: -7.6, r: 0.3, h: 4.1 }]);
    expect(lensClear(0.1, 1.9, -4.1, -6, -10, STREET_CANOPY_REACH)).toBe(true);
  });

  it('band fit keeps every point between −0.82 and the band top (top safe area for bubbles); pushBack honours it', () => {
    const pts: number[] = [];
    const box = (x: number, z: number) => { for (let m = 0; m < 8; m++) pts.push(m & 1 ? x + 0.55 : x - 0.55, m & 2 ? 2.4 : 0, m & 4 ? z + 0.55 : z - 0.55); };
    box(2, 1); box(5, -1);
    const el = 0.26, yaw = 0.5, top = 0.42;
    const b = new THREE.Vector3(Math.sin(yaw) * Math.cos(el), Math.sin(el), Math.cos(yaw) * Math.cos(el));
    const tanV = Math.tan(THREE.MathUtils.degToRad(21));
    const fit: ViewFit = { x: 0, y: 0, z: 0, depth: 0 };
    for (const minDepth of [0, 9.5]) {
      fitPointsToView(pts, pts.length / 3, b.x, b.y, b.z, tanV, 16 / 9, 0.82, minDepth, 0.6, fit, top);
      const c = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 500);
      c.position.set(fit.x, fit.y, fit.z); c.lookAt(fit.x - b.x, fit.y - b.y, fit.z - b.z); c.updateMatrixWorld();
      let hi = -Infinity;
      for (let i = 0; i < pts.length; i += 3) {
        const p = ndc(c, pts[i]!, pts[i + 1]!, pts[i + 2]!);
        expect(Math.abs(p.x)).toBeLessThanOrEqual(0.8201);
        expect(p.y).toBeGreaterThanOrEqual(-0.8201);
        expect(p.y).toBeLessThanOrEqual(top + 1e-3);
        hi = Math.max(hi, p.y);
      }
      if (minDepth === 0) expect(hi).toBeGreaterThan(top - 0.05); // tight
      // nothing to push for the exact fit
      expect(pushBackToFit(pts, pts.length / 3, fit.x, fit.y, fit.z, b.x, b.y, b.z, tanV, 16 / 9, 0.82, 0.6, top)).toBeLessThan(1e-6);
    }
  });
});
