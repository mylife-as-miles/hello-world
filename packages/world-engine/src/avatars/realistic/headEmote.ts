/**
 * Non-facial emotes for rigs without a facial rig (the photoreal scans have no morph targets, jaw or eyelid bones).
 * The same `setExpression(name, weight)` / `update(dt)` API drives small head/neck gesture layers that the rig blends
 * ADDITIVELY on top of whatever the animator posed (post-multiplied onto the canonical local rotation of 'neck' and
 * 'head', see the canonical frame in ../rig.ts: head x > 0 nods down, y > 0 looks left, z rolls the head):
 *  - happy:     a quick nod on onset, then chin slightly up with a friendly tilt
 *  - sad:       head and neck sink (slow), slight tilt
 *  - angry:     chin down and forward (neck leans, head tucks)
 *  - surprised: quick lift back with a small overshoot
 *  - relaxed:   a soft tilt with the chin a touch up
 *  - aa / oh:   tiny speech nods while talking
 *  - blink / neutral: nothing
 * Each expression's weight is followed by its own spring (fast for surprise, slow for sadness), so held moods settle
 * into a pose and flashes play as gestures. Pure math, Node-safe, allocation-free per frame.
 */
import { EXPRESSIONS, type ExpressionName } from '../rig';

/** Per-expression gesture: [neck pitch, head pitch, head yaw, head roll] at weight 1 (radians), spring ω, damping ζ. */
interface Gesture { pose: [number, number, number, number]; w: number; z: number }
const G: Partial<Record<ExpressionName, Gesture>> = {
  happy: { pose: [-0.02, -0.07, 0, 0.075], w: 7, z: 0.8 },
  sad: { pose: [0.13, 0.2, 0, -0.06], w: 3.6, z: 1 },
  angry: { pose: [0.14, 0.07, 0, 0], w: 7.5, z: 0.9 },
  surprised: { pose: [-0.07, -0.17, 0, 0], w: 15, z: 0.5 },
  relaxed: { pose: [0, -0.03, 0, -0.05], w: 3, z: 1 },
  aa: { pose: [0, 0.035, 0, 0], w: 22, z: 0.9 },
  oh: { pose: [0, -0.018, 0, 0], w: 18, z: 0.9 },
};
const NE = EXPRESSIONS.length;
const IDX: Record<string, number> = Object.fromEntries(EXPRESSIONS.map((e, i) => [e, i]));
const GEST: (Gesture | null)[] = EXPRESSIONS.map((e) => G[e] ?? null);
/** Onset nod for 'happy' (head pitch, rad/s per unit of weight gained) and its spring. */
const NOD_KICK = 1.8, NOD_W = 10, NOD_Z = 0.32;
const STEP = 1 / 120;

export class HeadEmote {
  private readonly target = new Float32Array(NE);
  private readonly s = new Float32Array(NE);
  private readonly v = new Float32Array(NE);
  private nod = 0;
  private nodV = 0;
  private lastHappy = 0;
  /** Additive Euler offsets (XYZ, radians) for the canonical neck and head. Read after update(). */
  readonly neck = { x: 0, y: 0, z: 0 };
  readonly head = { x: 0, y: 0, z: 0 };

  /** Expression weight 0..1 (unknown names are ignored). */
  set(name: ExpressionName, weight: number): void {
    const i = IDX[name];
    if (i === undefined) return;
    const w = Number.isFinite(weight) ? Math.min(1, Math.max(0, weight)) : 0;
    if (i === IDX.happy) {
      // a nod whenever happiness rises: impulse proportional to the gain, so it doesn't depend on how the rise is
      // split across frames / calls (the animator sends small smoothed steps)
      if (w > this.lastHappy) this.nodV += NOD_KICK * (w - this.lastHappy);
      this.lastHappy = w;
    }
    this.target[i] = w;
  }

  /** True while any layer is non-zero (the rig re-poses only then). */
  get active(): boolean {
    if (Math.abs(this.nod) > 1e-4 || Math.abs(this.nodV) > 1e-3) return true;
    for (let i = 0; i < NE; i++) if (Math.abs(this.s[i]!) > 1e-4 || Math.abs(this.v[i]!) > 1e-3 || this.target[i]! > 0) return true;
    return false;
  }

  update(dt: number): void {
    let t = Math.min(0.25, Math.max(0, Number.isFinite(dt) ? dt : 0));
    while (t > 1e-6) {
      const h = Math.min(STEP, t); t -= h;
      for (let i = 0; i < NE; i++) {
        const g = GEST[i];
        if (!g) continue;
        // damped spring toward the target weight (semi-implicit Euler; h * ω < 0.2 keeps it stable)
        const a = g.w * g.w * (this.target[i]! - this.s[i]!) - 2 * g.z * g.w * this.v[i]!;
        this.v[i] = this.v[i]! + a * h;
        this.s[i] = this.s[i]! + this.v[i]! * h;
      }
      const an = -NOD_W * NOD_W * this.nod - 2 * NOD_Z * NOD_W * this.nodV;
      this.nodV += an * h;
      this.nod += this.nodV * h;
    }
    // settle exactly at rest (lets the rig stop re-posing)
    for (let i = 0; i < NE; i++) if (this.target[i] === 0 && Math.abs(this.s[i]!) < 6e-4 && Math.abs(this.v[i]!) < 6e-3) { this.s[i] = 0; this.v[i] = 0; }
    if (Math.abs(this.nod) < 6e-4 && Math.abs(this.nodV) < 6e-3) { this.nod = 0; this.nodV = 0; }
    let np = 0, hp = 0, hy = 0, hr = 0;
    for (let i = 0; i < NE; i++) {
      const g = GEST[i], w = this.s[i]!;
      if (!g || w === 0) continue;
      np += g.pose[0] * w; hp += g.pose[1] * w; hy += g.pose[2] * w; hr += g.pose[3] * w;
    }
    hp += this.nod;
    this.neck.x = clamp(np, -0.15, 0.22); this.neck.y = 0; this.neck.z = 0;
    this.head.x = clamp(hp, -0.28, 0.32); this.head.y = clamp(hy, -0.3, 0.3); this.head.z = clamp(hr, -0.15, 0.15);
  }

  reset(): void {
    this.target.fill(0); this.s.fill(0); this.v.fill(0);
    this.nod = this.nodV = this.lastHappy = 0;
    this.neck.x = this.neck.y = this.neck.z = 0; this.head.x = this.head.y = this.head.z = 0;
  }
}

function clamp(v: number, a: number, b: number): number { return v < a ? a : v > b ? b : v; }
