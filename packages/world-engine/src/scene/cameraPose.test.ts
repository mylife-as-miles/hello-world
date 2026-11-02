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
