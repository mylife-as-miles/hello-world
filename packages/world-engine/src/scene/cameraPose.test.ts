/**
 * Camera pose picker: a resident seated at the Plaza Bench must never be framed through a lamp post
 * (or any tall prop in the central third), for every heading; and clutter is rejected even right
 * next to the subject (no near-subject exemption).
 */
import { describe, expect, it } from 'vitest';
import { getPoi } from '../world/layout';
import { buildTown } from './town';
import { centralClutter, pickFramingPose, segmentHitsProp, setCameraProps, type PickedPose } from './cameraPose';

const town = buildTown('low', { horizon: false });
const lampPosts = town.occluders.filter(o => o.r < 0.5 && o.h > 3.5 && o.h < 4.5);

describe('camera pose picker', () => {
  it('has lamp posts to test against near the Plaza Bench', () => {
    const seat = getPoi('bench-plaza-w')!.seats![0]!;
    expect(lampPosts.length).toBeGreaterThan(5);
    expect(lampPosts.some(l => Math.hypot(l.x - seat.x, l.z - seat.z) < 4)).toBe(true);
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
    // from the opposite side the lamp is behind the subject → fine
    expect(centralClutter(0, 3.1, -7, 0, 1.25, 0)).toBe(false);
  });
});
