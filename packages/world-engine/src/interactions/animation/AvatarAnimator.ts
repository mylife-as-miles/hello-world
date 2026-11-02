/**
 * TEMPORARY STUB animator (coordinator scaffold). The Animation & Interaction
 * engineer replaces the implementation but MUST keep this public API.
 */
import * as THREE from 'three';
import type { HumanoidRig, ExpressionName } from '../../avatars/rig';
import type { AnimationFamily } from '../../world/activities';

export type GestureName = 'wave' | 'greet' | 'bow' | 'cheer' | 'give' | 'nod' | 'shake' | 'clap' | 'shrug';

const e = new THREE.Euler();
const q = new THREE.Quaternion();

export class AvatarAnimator {
  private t = 0;
  private base: AnimationFamily = 'idle';
  private gesture: { name: GestureName; t: number; duration: number } | null = null;
  private speed = 1;
  constructor(private rig: HumanoidRig, private seed = 0) {}
  /** Looping base animation; crossfades from the previous one. `speed` scales walk/run cadence. */
  setBase(family: AnimationFamily, opts: { speed?: number } = {}): void { this.base = family; this.speed = opts.speed ?? 1; }
  getBase(): AnimationFamily { return this.base; }
  /** One-shot gesture layered over the base (upper body). */
  playGesture(name: GestureName, opts: { duration?: number } = {}): void { this.gesture = { name, t: 0, duration: opts.duration ?? 2 }; }
  setExpression(name: ExpressionName, weight: number): void { this.rig.setExpression(name, weight); }
  update(dt: number): void {
    this.t += dt * this.speed;
    const t = this.t + this.seed;
    const set = (bone: Parameters<HumanoidRig['setBoneRotation']>[0], x: number, y: number, z: number) => { e.set(x, y, z); q.setFromEuler(e); this.rig.setBoneRotation(bone, q); };
    const walk = this.base === 'walk' || this.base === 'run';
    const sw = walk ? Math.sin(t * 7) * (this.base === 'run' ? 0.8 : 0.5) : 0;
    set('leftUpperArm', sw * 0.6, 0, -1.25);
    set('rightUpperArm', -sw * 0.6, 0, 1.25);
    set('leftUpperLeg', -sw, 0, 0); set('rightUpperLeg', sw, 0, 0);
    set('leftLowerLeg', Math.max(0, sw) * 0.8, 0, 0); set('rightLowerLeg', Math.max(0, -sw) * 0.8, 0, 0);
    set('spine', 0.02 * Math.sin(t * 1.6), 0, 0);
    if (this.base === 'dance') { set('hips', 0, Math.sin(t * 4) * 0.3, 0); set('leftUpperArm', 0, 0, -0.3 + Math.sin(t * 8) * 0.3); set('rightUpperArm', 0, 0, 0.3 - Math.sin(t * 8) * 0.3); }
    if (this.gesture) {
      this.gesture.t += dt;
      if (this.gesture.name === 'wave') { set('rightUpperArm', 0, 0, -1.1); set('rightLowerArm', 0, 0, -0.6 + Math.sin(this.gesture.t * 10) * 0.4); }
      if (this.gesture.t > this.gesture.duration) this.gesture = null;
    }
    this.rig.setHipsOffset(0, walk ? Math.abs(Math.sin(t * 7)) * 0.03 : Math.sin(t * 1.6) * 0.005, 0);
    this.rig.update(dt);
  }
}
