/**
 * AvatarAnimator — fully procedural animation on the canonical humanoid frame
 * (see src/avatars/rig.ts). Works for every HumanoidRig (procedural + VRM).
 *
 *  - Base loops for every AnimationFamily, crossfaded (pose-space blend).
 *  - Walk/run share one locomotion phase; cadence + stride follow `speed`
 *    (speed 1 = WALK_SPEED / RUN_SPEED m/s) so feet roughly match ground speed.
 *  - One-shot upper-body gestures layered on top with smooth envelopes.
 *  - Automatic blinking, look-around, family moods, mouth flaps, flashes.
 * Zero per-frame allocations: poses are Float32Array buffers.
 */
import * as THREE from 'three';
import { EXPRESSIONS, HUMAN_BONES, type ExpressionName, type HumanBoneName, type HumanoidRig } from '../../avatars/rig';
import type { AnimationFamily } from '../../world/activities';

export type GestureName = 'wave' | 'greet' | 'bow' | 'cheer' | 'give' | 'nod' | 'shake' | 'clap' | 'shrug';

export const ANIMATION_FAMILIES: readonly AnimationFamily[] = [
  'idle', 'walk', 'run', 'talk', 'wave', 'dance', 'celebrate', 'give', 'sit', 'sleep', 'play', 'sad', 'think', 'laugh',
];
export const GESTURE_NAMES: readonly GestureName[] = ['wave', 'greet', 'bow', 'cheer', 'give', 'nod', 'shake', 'clap', 'shrug'];
/** Ground speed (m/s) that `setBase('walk' | 'run', { speed: 1 })` represents. */
export const WALK_SPEED = 1.3;
export const RUN_SPEED = 3.4;
/** Default seat height (m) used by the sit/sleep poses. */
export const DEFAULT_SEAT_HEIGHT = 0.45;

const GESTURE_DURATION: Record<GestureName, number> = {
  wave: 2.4, greet: 1.7, bow: 1.9, cheer: 2.2, give: 2.2, nod: 1.2, shake: 1.4, clap: 2.0, shrug: 1.6,
};

// ---------------------------------------------------------------------------
// Pose buffers: per bone [x, y, z, twist] (Euler XYZ + pre-twist about the
// bone's rest X axis, i.e. the arm's long axis) followed by hips offset xyz.
// ---------------------------------------------------------------------------
const NB = HUMAN_BONES.length;
const IDX = {} as Record<HumanBoneName, number>;
HUMAN_BONES.forEach((b, i) => { IDX[b] = i * 4; });
const HO = NB * 4;
const POSE_LEN = HO + 3;
type Pose = Float32Array;
const TAU = Math.PI * 2;

function S(p: Pose, b: HumanBoneName, x: number, y: number, z: number, tw = 0) {
  const o = IDX[b]; p[o] = x; p[o + 1] = y; p[o + 2] = z; p[o + 3] = tw;
}
function A(p: Pose, b: HumanBoneName, x: number, y: number, z: number) {
  const o = IDX[b]; p[o] += x; p[o + 1] += y; p[o + 2] += z;
}
/** Blend one bone toward a target with weight w. */
function BL(p: Pose, b: HumanBoneName, x: number, y: number, z: number, tw: number, w: number) {
  const o = IDX[b];
  p[o] += (x - p[o]) * w; p[o + 1] += (y - p[o + 1]) * w; p[o + 2] += (z - p[o + 2]) * w; p[o + 3] += (tw - p[o + 3]) * w;
}
/**
 * Arm helper. s = +1 left, -1 right. swing < 0 = forward, down = 1.25 hangs at
 * the side (0 = T-pose, -1.2 = overhead), yaw > 0 sweeps a T-pose arm forward,
 * twist > 0 = internal rotation, elbow > 0 = forearm bends (palm side).
 */
function arm(p: Pose, s: number, swing: number, down: number, yaw: number, twist: number, elbow: number) {
  S(p, s > 0 ? 'leftUpperArm' : 'rightUpperArm', swing, -s * yaw, -s * down, twist);
  S(p, s > 0 ? 'leftLowerArm' : 'rightLowerArm', 0, -s * elbow, 0, 0);
}
function armBL(p: Pose, s: number, swing: number, down: number, yaw: number, twist: number, elbow: number, w: number) {
  BL(p, s > 0 ? 'leftUpperArm' : 'rightUpperArm', swing, -s * yaw, -s * down, twist, w);
  BL(p, s > 0 ? 'leftLowerArm' : 'rightLowerArm', 0, -s * elbow, 0, 0, w);
}
function hand(p: Pose, s: number, flex: number, dev: number) {
  S(p, s > 0 ? 'leftHand' : 'rightHand', 0, -s * flex, -s * dev);
}
/** Leg helper. flex > 0 = thigh forward, abduct > 0 = leg out, knee > 0 bends, ankle > 0 = toes down. */
function leg(p: Pose, s: number, flex: number, abduct: number, knee: number, ankle: number) {
  S(p, s > 0 ? 'leftUpperLeg' : 'rightUpperLeg', -flex, 0, s * abduct);
  S(p, s > 0 ? 'leftLowerLeg' : 'rightLowerLeg', knee, 0, 0);
  S(p, s > 0 ? 'leftFoot' : 'rightFoot', ankle, 0, 0);
}
function hipsOff(p: Pose, x: number, y: number, z: number) { p[HO] = x; p[HO + 1] = y; p[HO + 2] = z; }

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth01 = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const pos = (v: number) => (v > 0 ? v : 0);
/** Attack/release envelope for one-shots. */
function envelope(t: number, d: number, attack: number, release: number) {
  return smooth01(t / attack) * smooth01((d - t) / release);
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _qt = new THREE.Quaternion();
const _X = new THREE.Vector3(1, 0, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

const EXPR_INDEX = {} as Record<ExpressionName, number>;
EXPRESSIONS.forEach((n, i) => { EXPR_INDEX[n] = i; });
const NE = EXPRESSIONS.length;

interface GestureState { name: GestureName; t: number; duration: number; weight: number }

/** Mood expressions implied by a base family. */
function familyMood(f: AnimationFamily, out: Float32Array) {
  out.fill(0);
  const h = EXPR_INDEX.happy, r = EXPR_INDEX.relaxed;
  switch (f) {
    case 'idle': out[r] = 0.15; out[h] = 0.12; break;
    case 'talk': out[h] = 0.35; break;
    case 'wave': out[h] = 0.75; break;
    case 'dance': out[h] = 0.85; break;
    case 'celebrate': out[h] = 1; out[EXPR_INDEX.aa] = 0.35; break;
    case 'give': out[h] = 0.7; break;
    case 'sit': out[r] = 0.35; out[h] = 0.1; break;
    case 'sleep': out[r] = 0.6; out[EXPR_INDEX.blink] = 1; break;
    case 'play': out[h] = 0.85; break;
    case 'sad': out[EXPR_INDEX.sad] = 0.85; break;
    case 'think': out[r] = 0.2; out[EXPR_INDEX.oh] = 0.12; break;
    case 'laugh': out[h] = 1; break;
    case 'run': out[h] = 0.2; break;
    default: break;
  }
}

export class AvatarAnimator {
  private t = 0;
  private base: AnimationFamily = 'idle';
  private prevBase: AnimationFamily = 'idle';
  private speed = 1;
  private prevSpeed = 1;
  private fade = 1;
  private fadeDur = 0.4;
  private locoPhase = 0;
  private readonly poseA: Pose = new Float32Array(POSE_LEN);
  private readonly poseB: Pose = new Float32Array(POSE_LEN);
  private readonly out: Pose = new Float32Array(POSE_LEN);
  private gesture: GestureState | null = null;
  private gestureOut: GestureState | null = null;
  private readonly rand: () => number;
  private readonly groove: number;
  private readonly tempo: number;
  private readonly ph: number[];
  // look-around
  private lookYaw = 0; private lookPitch = 0;
  private lookYawT = 0; private lookPitchT = 0; private lookTimer = 2;
  private extLook: { yaw: number; pitch: number } | null = null;
  // expressions
  private readonly exprCur = new Float32Array(NE);
  private readonly exprMood = new Float32Array(NE);
  private readonly exprManual = new Float32Array(NE);
  private readonly exprFlash = new Float32Array(NE);
  private readonly exprFlashT = new Float32Array(NE);
  private readonly exprSent = new Float32Array(NE).fill(-1);
  private blinkT = -1;
  private nextBlink = 2;
  private talking = false;
  private talkingTimer = 0;
  // rig metrics
  private readonly hipH: number;
  private readonly kneeH: number;
  private readonly k: number;
  private seatHeight = DEFAULT_SEAT_HEIGHT;
  private walkA = 0.38; private runA = 0.55;

  constructor(private rig: HumanoidRig, private seed = 0) {
    this.rand = mulberry32((seed | 0) ^ 0x9e3779b9);
    this.groove = Math.floor(this.rand() * 3);
    this.tempo = 0.92 + this.rand() * 0.16;
    this.ph = Array.from({ length: 8 }, () => this.rand() * TAU);
    this.nextBlink = 1 + this.rand() * 3;
    this.lookTimer = 1 + this.rand() * 3;
    const H = rig.height > 0.3 ? rig.height : 1.7;
    this.k = H / 1.7;
    const m = measureLegs(rig);
    this.hipH = m ? clamp(m.hip, 0.3 * H, 0.66 * H) : 0.53 * H;
    this.kneeH = m ? clamp(m.knee, 0.15 * H, 0.4 * H) : 0.27 * H;
  }

  /** Looping base animation; crossfades from the previous one. `speed` scales walk/run cadence (1 = WALK_SPEED/RUN_SPEED m/s) or the tempo of other loops. */
  setBase(family: AnimationFamily, opts: { speed?: number } = {}): void {
    const speed = clamp(opts.speed ?? 1, 0.2, 3);
    if (family === this.base) { this.speed = speed; return; }
    const loco = (f: AnimationFamily) => f === 'walk' || f === 'run';
    const seated = (f: AnimationFamily) => f === 'sit' || f === 'sleep';
    this.fadeDur = loco(family) && loco(this.base) ? 0.3 : seated(family) !== seated(this.base) ? 0.75 : 0.4;
    // If a fade is still in progress, blend from the dominant pose.
    this.prevBase = this.fade < 0.5 ? this.prevBase : this.base;
    this.prevSpeed = this.speed;
    this.base = family;
    this.speed = speed;
    this.fade = 0;
  }
  getBase(): AnimationFamily { return this.base; }
  /** One-shot gesture layered over the base (upper body). */
  playGesture(name: GestureName, opts: { duration?: number } = {}): void {
    if (this.gesture) this.gestureOut = this.gesture;
    this.gesture = { name, t: 0, duration: Math.max(0.6, opts.duration ?? GESTURE_DURATION[name] ?? 2), weight: 1 };
    if (name === 'wave' || name === 'greet' || name === 'cheer' || name === 'clap' || name === 'give') this.flashExpression('happy', 0.9, this.gesture.duration + 0.6);
    else if (name === 'shrug') this.flashExpression('surprised', 0.45, this.gesture.duration);
    else if (name === 'shake') this.flashExpression('sad', 0.35, this.gesture.duration);
  }
  /** Currently playing gesture (null when none). */
  getGesture(): GestureName | null { return this.gesture?.name ?? null; }
  /** Persistent manual expression weight (e.g. creator preview). 0 clears it. */
  setExpression(name: ExpressionName, weight: number): void {
    const i = EXPR_INDEX[name];
    if (i !== undefined) this.exprManual[i] = clamp(weight, 0, 1);
  }
  /** Temporary expression that decays after `seconds` (event reactions). */
  flashExpression(name: ExpressionName, weight: number, seconds = 2.5): void {
    const i = EXPR_INDEX[name];
    if (i === undefined) return;
    this.exprFlash[i] = Math.max(this.exprFlash[i]!, clamp(weight, 0, 1));
    this.exprFlashT[i] = Math.max(this.exprFlashT[i]!, seconds);
  }
  /** Mouth flaps while true (or for `seconds` when given), regardless of base family. */
  setTalking(on: boolean, seconds?: number): void {
    this.talking = on;
    this.talkingTimer = on && seconds ? seconds : 0;
  }
  /** Head/neck look offset relative to the body (radians, yaw > 0 = look left). null = automatic look-around. */
  setHeadLook(yaw: number | null, pitch = 0): void {
    if (yaw === null) { this.extLook = null; return; }
    this.extLook = { yaw: clamp(yaw, -1.1, 1.1), pitch: clamp(pitch, -0.5, 0.5) };
  }
  /** Seat height (m) for sit/sleep. Default 0.45. */
  setSeatHeight(h: number): void { this.seatHeight = clamp(h, 0.2, 0.9); }

  update(dt: number): void {
    dt = clamp(dt, 0, 0.1);
    const loco = this.base === 'walk' || this.base === 'run';
    this.t += dt * this.tempo * (loco ? 1 : this.speed);
    if (this.fade < 1) this.fade = Math.min(1, this.fade + dt / this.fadeDur);
    const w = smooth01(this.fade);

    // Locomotion: cadence from ground speed + leg length (pendulum scaling).
    const legL = this.hipH;
    const pend = Math.sqrt(0.9 / legL);
    const freqOf = (f: AnimationFamily, sp: number) => {
      if (f === 'walk') {
        const v = WALK_SPEED * sp, fr = 0.92 * Math.sqrt(sp) * pend;
        this.walkA = Math.asin(clamp(v / fr / (3.7 * legL), 0.05, 0.8));
        return fr;
      }
      if (f === 'run') {
        const v = RUN_SPEED * sp, fr = 1.32 * Math.sqrt(sp) * pend;
        this.runA = Math.asin(clamp(v / fr / (5.4 * legL), 0.12, 0.85));
        return fr;
      }
      return 0;
    };
    const fPrev = this.fade < 1 ? freqOf(this.prevBase, this.prevSpeed) : 0;
    const fCur = freqOf(this.base, this.speed);
    const freq = this.fade < 1 ? fPrev + (fCur - fPrev) * w : fCur;
    if (freq > 0) this.locoPhase = (this.locoPhase + TAU * freq * dt) % TAU;

    this.updateLook(dt);

    const out = this.out;
    this.computeBase(this.base, this.poseB, this.speed);
    if (this.fade < 1) {
      this.computeBase(this.prevBase, this.poseA, this.prevSpeed);
      for (let i = 0; i < POSE_LEN; i++) out[i] = this.poseA[i]! + (this.poseB[i]! - this.poseA[i]!) * w;
    } else out.set(this.poseB);

    // Additive head look (auto look-around or external target).
    const lookScale = this.lookScale(this.base) * (this.fade < 1 ? w : 1) + (this.fade < 1 ? this.lookScale(this.prevBase) * (1 - w) : 0);
    A(out, 'neck', this.lookPitch * 0.35 * lookScale, this.lookYaw * 0.4 * lookScale, 0);
    A(out, 'head', this.lookPitch * 0.65 * lookScale, this.lookYaw * 0.6 * lookScale, 0);

    // Gestures (upper body).
    if (this.gestureOut) {
      const g = this.gestureOut;
      g.t += dt; g.weight -= dt / 0.25;
      if (g.weight <= 0 || g.t >= g.duration) this.gestureOut = null;
      else this.applyGesture(g, out, g.weight);
    }
    if (this.gesture) {
      const g = this.gesture;
      g.t += dt;
      if (g.t >= g.duration) this.gesture = null;
      else this.applyGesture(g, out, 1);
    }

    applyPose(this.rig, out);
    this.updateExpressions(dt, w);
    this.rig.update(dt);
  }

  // -------------------------------------------------------------------------
  private lookScale(f: AnimationFamily): number {
    switch (f) {
      case 'sleep': return 0;
      case 'walk': case 'run': case 'dance': case 'celebrate': case 'play': case 'laugh': return 0.35;
      case 'think': case 'sad': return 0.5;
      default: return 1;
    }
  }

  private updateLook(dt: number) {
    if (this.extLook) { this.lookYawT = this.extLook.yaw; this.lookPitchT = this.extLook.pitch; }
    else if ((this.lookTimer -= dt) <= 0) {
      const r = this.rand();
      this.lookTimer = 2.5 + this.rand() * 4.5;
      if (r < 0.4) { this.lookYawT = 0; this.lookPitchT = 0; }
      else { this.lookYawT = (this.rand() - 0.5) * 1.2; this.lookPitchT = (this.rand() - 0.6) * 0.25; }
    }
    const a = 1 - Math.exp(-dt * (this.extLook ? 5 : 3));
    this.lookYaw += (this.lookYawT - this.lookYaw) * a;
    this.lookPitch += (this.lookPitchT - this.lookPitch) * a;
  }

  private noise(t: number, i: number) {
    const p = this.ph;
    return (Math.sin(t + p[i % 8]!) + 0.6 * Math.sin(t * 1.618 + p[(i + 3) % 8]!) + 0.3 * Math.sin(t * 2.71 + p[(i + 5) % 8]!)) / 1.9;
  }

  private computeBase(f: AnimationFamily, p: Pose, speed: number) {
    p.fill(0);
    switch (f) {
      case 'walk': this.poseLoco(p, false, speed); break;
      case 'run': this.poseLoco(p, true, speed); break;
      case 'talk': this.poseTalk(p); break;
      case 'wave': this.poseIdle(p, 0.6); this.waveArm(p, this.t, 1); break;
      case 'dance': this.poseDance(p); break;
      case 'celebrate': this.poseCelebrate(p); break;
      case 'give': this.poseGive(p); break;
      case 'sit': this.poseSit(p, false); break;
      case 'sleep': this.poseSit(p, true); break;
      case 'play': this.posePlay(p); break;
      case 'sad': this.poseSad(p); break;
      case 'think': this.poseThink(p); break;
      case 'laugh': this.poseLaugh(p); break;
      default: this.poseIdle(p, 1); break;
    }
  }

  /** Standing idle: breathing, weight shift, relaxed arms. */
  private poseIdle(p: Pose, armAmt: number) {
    const t = this.t, k = this.k;
    const br = Math.sin(t * 1.9 + this.ph[0]!);
    const sway = Math.sin(t * 0.42 + this.ph[1]!);
    const roll = 0.035 * sway;
    S(p, 'hips', 0, 0.03 * sway, roll);
    S(p, 'spine', 0.03 + 0.01 * br, -0.015 * sway, -roll * 0.6);
    S(p, 'chest', 0.015 + 0.02 * br, -0.01 * sway, -roll * 0.3);
    S(p, 'upperChest', 0.01 * br, 0, 0);
    S(p, 'neck', -0.03, 0, 0);
    S(p, 'head', -0.02 - 0.01 * br, 0, roll * 0.4);
    // Legs counter the pelvis roll so feet stay planted; the unloaded knee relaxes.
    S(p, 'leftUpperLeg', -0.02 - 0.06 * pos(-sway), 0, -roll + 0.02);
    S(p, 'rightUpperLeg', -0.02 - 0.06 * pos(sway), 0, -roll - 0.02);
    S(p, 'leftLowerLeg', 0.04 + 0.14 * pos(-sway), 0, 0);
    S(p, 'rightLowerLeg', 0.04 + 0.14 * pos(sway), 0, 0);
    S(p, 'leftFoot', -0.02 - 0.08 * pos(-sway), 0, roll);
    S(p, 'rightFoot', -0.02 - 0.08 * pos(sway), 0, roll);
    hipsOff(p, 0.022 * sway * k, (-0.006 - 0.004 * br - 0.008 * Math.abs(sway)) * k, 0);
    const a = armAmt;
    arm(p, 1, 0.04 + 0.02 * br * a, 1.2 + 0.02 * br, 0, 0.15, 0.2 + 0.04 * Math.sin(t * 0.7 + 1));
    arm(p, -1, 0.04 + 0.02 * br * a, 1.2 + 0.02 * br, 0, 0.15, 0.22 + 0.04 * Math.sin(t * 0.6));
    hand(p, 1, 0.1, 0.05); hand(p, -1, 0.1, 0.05);
  }

  /** Walk / run cycle with arm swing, pelvis rotation, bob and head stabilisation. */
  private poseLoco(p: Pose, run: boolean, speed: number) {
    const ph = this.locoPhase, k = this.k;
    const s = Math.sin(ph), c = Math.cos(ph), c2 = Math.cos(2 * ph);
    const Aleg = run ? this.runA : this.walkA;
    const kneeSwing = run ? 1.55 : 1.0;
    const swingL = pos(Math.cos(ph + 0.45)), swingR = pos(Math.cos(ph + Math.PI + 0.45));
    const flexL = Aleg * s + (run ? 0.12 : 0.03), flexR = -Aleg * s + (run ? 0.12 : 0.03);
    const kneeL = (run ? 0.3 : 0.07) + kneeSwing * swingL * swingL + (run ? 0 : 0.12 * pos(-c) * pos(s));
    const kneeR = (run ? 0.3 : 0.07) + kneeSwing * swingR * swingR + (run ? 0 : 0.12 * pos(c) * pos(-s));
    const ankL = 0.75 * (flexL - kneeL) + 0.25 * pos(-s) * pos(c * -1 + 0.3);
    const ankR = 0.75 * (flexR - kneeR) + 0.25 * pos(s) * pos(c + 0.3);
    const list = run ? 0 : 0.04 * c;
    leg(p, 1, flexL, 0.02 + list, kneeL, ankL);
    leg(p, -1, flexR, 0.02 - list, kneeR, ankR);
    A(p, 'leftUpperLeg', 0, 0, -list * 2); A(p, 'rightUpperLeg', 0, 0, -list * 2);
    const yaw = (run ? 0.16 : 0.13) * (Aleg / 0.4) * s;
    const lean = run ? 0.16 + 0.04 * speed : 0.04 + 0.02 * speed;
    S(p, 'hips', run ? 0.06 : 0.02, -yaw, -list);
    S(p, 'spine', lean, yaw * 0.6, list * 0.6);
    S(p, 'chest', run ? 0.05 : 0.02, yaw * 0.9, list * 0.4);
    S(p, 'neck', -lean * 0.5, -yaw * 0.25, 0);
    S(p, 'head', -lean * 0.3 + (run ? 0.03 : 0.015) * c2, -yaw * 0.3, -list * 0.5);
    const bob = run ? (-0.06 + 0.06 * Math.abs(s)) * k : (-0.012 + 0.018 * c2) * k;
    hipsOff(p, (run ? -0.01 : -0.022) * c * k, bob, 0);
    if (run) {
      const sw = 0.7 * clamp(speed, 0.6, 1.3);
      arm(p, 1, 0.1 + sw * s, 1.2, 0, 0.55, 1.45 - 0.2 * s);
      arm(p, -1, 0.1 - sw * s, 1.2, 0, 0.55, 1.45 + 0.2 * s);
      hand(p, 1, 0.2, 0); hand(p, -1, 0.2, 0);
    } else {
      const sw = 0.42 * clamp(Math.sqrt(speed), 0.6, 1.3);
      arm(p, 1, 0.05 + sw * s, 1.24, 0, 0.25, 0.25 + 0.25 * pos(-s));
      arm(p, -1, 0.05 - sw * s, 1.24, 0, 0.25, 0.25 + 0.25 * pos(s));
      hand(p, 1, 0.12, 0.05); hand(p, -1, 0.12, 0.05);
    }
  }

  private poseTalk(p: Pose) {
    this.poseIdle(p, 0.5);
    const t = this.t;
    const g1 = this.noise(t * 0.9, 0), g2 = this.noise(t * 1.25, 2), beat = Math.sin(t * 5.4);
    arm(p, -1, -0.38 - 0.22 * g1, 1.18 - 0.08 * pos(g1), 0, 0.45, 1.35 + 0.3 * pos(g1) + 0.1 * beat * pos(g1 + 0.3));
    arm(p, 1, -0.12 - 0.25 * pos(g2), 1.22, 0, 0.35 + 0.2 * pos(g2), 0.35 + 0.9 * pos(g2));
    hand(p, -1, -0.25 + 0.15 * beat, 0.15); hand(p, 1, -0.15, 0.1);
    A(p, 'chest', 0, 0.06 * g1, 0);
    A(p, 'head', 0.05 * Math.sin(t * 3.1) * pos(g2 + 0.2), 0.08 * g1, 0.06 * Math.sin(t * 0.8));
  }

  /** Right-arm wave (shoulder abducted, externally rotated, forearm rocking). */
  private waveArm(p: Pose, t: number, w: number) {
    const osc = Math.sin(t * TAU * 2.1);
    armBL(p, -1, -0.3, -0.18, 0, -1.45, 1.45 + 0.42 * osc, w);
    BL(p, 'rightHand', 0, 0, 0.15 * osc, 0, w);
    BL(p, 'chest', p[IDX.chest]!, p[IDX.chest + 1]!, -0.05, 0, w);
    BL(p, 'head', p[IDX.head]!, -0.08, 0.08, 0, w);
  }

  private poseDance(p: Pose) {
    const t = this.t, k = this.k;
    const b = t * TAU * 2.0;             // 120 bpm beat
    const half = Math.sin(b / 2), bounce = 0.5 - 0.5 * Math.cos(b);
    const g = this.groove;
    if (g === 0) {
      // Bounce & pump: knee bounce on every beat, alternating fist pumps, hip sway.
      leg(p, 1, 0.12 + 0.18 * bounce, 0.08, 0.25 + 0.4 * bounce, -0.12 - 0.22 * bounce);
      leg(p, -1, 0.12 + 0.18 * bounce, 0.08, 0.25 + 0.4 * bounce, -0.12 - 0.22 * bounce);
      S(p, 'hips', 0.04, 0.12 * half, 0.07 * half);
      S(p, 'spine', 0.08 + 0.05 * bounce, -0.08 * half, -0.06 * half);
      S(p, 'chest', 0.02, -0.12 * half, -0.03 * half);
      S(p, 'head', 0.1 * bounce - 0.05, 0.1 * half, 0.05 * half);
      arm(p, 1, -0.55 - 0.45 * half, 1.0, 0, 0.5, 1.6 - 0.3 * half);
      arm(p, -1, -0.55 + 0.45 * half, 1.0, 0, 0.5, 1.6 + 0.3 * half);
      hipsOff(p, 0.04 * half * k, (-0.04 - 0.05 * bounce) * k, 0);
    } else if (g === 1) {
      // Side-step sway with arms overhead.
      const side = half;
      leg(p, 1, 0.08 + 0.15 * pos(-side), 0.1 + 0.06 * pos(side), 0.15 + 0.45 * pos(-side) + 0.15 * bounce, -0.1 - 0.2 * pos(-side));
      leg(p, -1, 0.08 + 0.15 * pos(side), 0.1 + 0.06 * pos(-side), 0.15 + 0.45 * pos(side) + 0.15 * bounce, -0.1 - 0.2 * pos(side));
      S(p, 'hips', 0.02, 0.06 * side, 0.12 * side);
      S(p, 'spine', 0.04, 0, -0.16 * side);
      S(p, 'chest', 0, 0.08 * side, -0.08 * side);
      S(p, 'head', 0.06 * bounce, -0.1 * side, -0.08 * side);
      arm(p, 1, -0.15, -0.85 + 0.15 * side, 0, 0.2, 0.45 + 0.2 * bounce);
      arm(p, -1, -0.15, -0.85 - 0.15 * side, 0, 0.2, 0.45 + 0.2 * bounce);
      hand(p, 1, 0, 0.3 * side); hand(p, -1, 0, -0.3 * side);
      hipsOff(p, 0.09 * side * k, (-0.05 - 0.035 * bounce) * k, 0);
    } else {
      // Disco point: right arm points up/down every two beats, left hand on hip.
      const up = Math.sin(b / 2) > 0 ? 1 : 0;
      const pt = smooth01(0.5 + 2.5 * Math.sin(b / 2));
      leg(p, 1, 0.1 + 0.12 * bounce, 0.12, 0.2 + 0.35 * bounce, -0.1 - 0.15 * bounce);
      leg(p, -1, 0.18 + 0.1 * pt, 0.06, 0.3 + 0.3 * bounce, -0.15 - 0.1 * bounce);
      S(p, 'hips', 0.03, 0.15 * (pt - 0.5), 0.1 * (pt - 0.5));
      S(p, 'spine', 0.05, -0.12 * (pt - 0.5), -0.12 * (pt - 0.5));
      S(p, 'chest', 0, -0.1 * (pt - 0.5), -0.05);
      S(p, 'head', 0.08 * bounce - 0.08 * pt, -0.25 * (pt - 0.5), 0.1 * (pt - 0.5));
      arm(p, -1, -0.25 - 0.3 * (1 - pt), -1.0 * pt + 1.15 * (1 - pt), 0.35 * (1 - pt), 0.1, 0.12);
      hand(p, -1, 0, 0.2 * up);
      arm(p, 1, 0.25, 1.05, 0, -0.9, 1.75);
      hipsOff(p, 0.05 * (pt - 0.5) * k, (-0.04 - 0.04 * bounce) * k, 0);
    }
  }

  private poseCelebrate(p: Pose) {
    const t = this.t, k = this.k;
    const w = t * TAU * 1.5;
    const s = Math.sin(w), air = pos(s), crouch = pos(-s);
    leg(p, 1, 0.05 + 0.35 * crouch + 0.1 * air, 0.06, 0.1 + 0.7 * crouch + 0.25 * air, -0.05 - 0.35 * crouch + 0.35 * air);
    leg(p, -1, 0.05 + 0.35 * crouch + 0.1 * air, 0.06, 0.1 + 0.7 * crouch + 0.25 * air, -0.05 - 0.35 * crouch + 0.35 * air);
    S(p, 'hips', 0.05 * crouch, 0, 0);
    S(p, 'spine', -0.05 + 0.12 * crouch, 0, 0);
    S(p, 'chest', -0.06, 0, 0);
    S(p, 'head', -0.18 + 0.06 * crouch, 0.1 * Math.sin(t * 1.3), 0);
    const pump = Math.sin(w * 2);
    arm(p, 1, -0.15, -0.95 + 0.12 * pump, 0, 0.3, 0.35 + 0.25 * pos(pump));
    arm(p, -1, -0.15, -0.95 - 0.12 * pump, 0, 0.3, 0.35 + 0.25 * pos(-pump));
    hipsOff(p, 0, (0.12 * air - 0.09 * crouch) * k, 0);
  }

  private poseGive(p: Pose) {
    this.poseIdle(p, 0.3);
    const t = this.t;
    const br = Math.sin(t * 1.9);
    A(p, 'spine', 0.12, 0, 0);
    A(p, 'head', 0.1, 0, 0.06);
    arm(p, 1, -0.95 + 0.03 * br, 1.18, 0, 0.55, 0.6);
    arm(p, -1, -0.95 + 0.03 * br, 1.18, 0, 0.55, 0.6);
    hand(p, 1, -0.3, 0); hand(p, -1, -0.3, 0);
  }

  /** Seated on a ~0.45 m seat: hips lowered, thighs forward, shins down, hands on lap. */
  private poseSit(p: Pose, sleep: boolean) {
    const t = this.t, k = this.k;
    const br = Math.sin(t * (sleep ? 1.1 : 1.8) + this.ph[2]!);
    const hipSit = this.seatHeight + 0.08 * k;
    const thigh = Math.max(0.1, this.hipH - this.kneeH);
    // Tilt thighs so shins can hang vertical with feet on the ground.
    const delta = Math.asin(clamp((hipSit - this.kneeH) / thigh, -0.45, 0.6));
    const flex = Math.PI / 2 - delta;
    // Shin tilts forward just enough for the feet to reach the ground (low seats / ground).
    const kneeY = hipSit - thigh * Math.sin(delta);
    const shinFwd = Math.acos(clamp(kneeY / Math.max(0.1, this.kneeH), -1, 1)) + 0.06;
    leg(p, 1, flex, 0.1, flex - shinFwd, 0.04 + shinFwd * 0.85);
    leg(p, -1, flex, 0.1, flex - shinFwd, 0.04 + shinFwd * 0.85);
    A(p, 'leftUpperLeg', 0, -0.06, 0); A(p, 'rightUpperLeg', 0, 0.06, 0);
    hipsOff(p, 0, hipSit - this.hipH, -0.06 * k);
    if (!sleep) {
      const sway = Math.sin(t * 0.5 + this.ph[3]!);
      S(p, 'hips', -0.08, 0, 0);
      S(p, 'spine', 0.1 + 0.01 * br, 0.02 * sway, 0);
      S(p, 'chest', 0.02 + 0.02 * br, 0.02 * sway, 0);
      S(p, 'neck', -0.02, 0, 0);
      S(p, 'head', 0.02, 0, 0.04 * sway);
      arm(p, 1, -0.5, 1.36, 0, 0.95, 0.95);
      arm(p, -1, -0.5, 1.36, 0, 0.95, 0.95);
      hand(p, 1, 0.25, 0); hand(p, -1, 0.25, 0);
    } else {
      const nod = 0.04 * Math.sin(t * 0.35 + this.ph[4]!);
      S(p, 'hips', -0.12, 0, 0);
      S(p, 'spine', 0.2 + 0.015 * br, 0, 0.04);
      S(p, 'chest', 0.12 + 0.025 * br, 0, 0.03);
      S(p, 'neck', 0.2, 0, 0.1);
      S(p, 'head', 0.35 + nod, 0.1, 0.22);
      arm(p, 1, -0.4, 1.4, 0, 1.0, 0.9);
      arm(p, -1, -0.4, 1.4, 0, 1.0, 0.9);
      hand(p, 1, 0.35, 0); hand(p, -1, 0.35, 0);
    }
  }

  private posePlay(p: Pose) {
    const t = this.t, k = this.k;
    const w = t * TAU * 2.2;
    const s = Math.sin(w), hop = pos(Math.sin(w * 2)), alt = Math.sin(w);
    leg(p, 1, 0.1 + 0.25 * pos(alt), 0.05, 0.2 + 0.5 * pos(alt), -0.1 + 0.25 * hop);
    leg(p, -1, 0.1 + 0.25 * pos(-alt), 0.05, 0.2 + 0.5 * pos(-alt), -0.1 + 0.25 * hop);
    // Occasional twirl every ~6 s.
    const cyc = (t * 0.16 + this.ph[5]! / TAU) % 1;
    const spin = cyc > 0.82 ? smooth01((cyc - 0.82) / 0.18) * TAU : 0;
    S(p, 'hips', 0.05, spin, 0.05 * alt);
    S(p, 'spine', 0.06, -0.08 * alt, 0);
    S(p, 'chest', 0, -0.1 * alt, 0);
    S(p, 'head', -0.05 + 0.05 * hop, 0.15 * Math.sin(t * 1.7), 0.08 * alt);
    arm(p, 1, 0.6 * s - 0.2, 0.85, 0, 0.3, 0.7);
    arm(p, -1, -0.6 * s - 0.2, 0.85, 0, 0.3, 0.7);
    hipsOff(p, 0, (0.06 * hop - 0.04) * k, 0);
  }

  private poseSad(p: Pose) {
    const t = this.t, k = this.k;
    const br = Math.sin(t * 1.2 + this.ph[0]!);
    const sigh = Math.pow(pos(Math.sin(t * 0.55 + this.ph[6]!)), 6);
    const sway = Math.sin(t * 0.35);
    S(p, 'hips', 0.02, 0.02 * sway, 0.02 * sway);
    S(p, 'spine', 0.14 - 0.06 * sigh, 0, 0);
    S(p, 'chest', 0.14 + 0.02 * br - 0.08 * sigh, 0, 0);
    S(p, 'neck', 0.12, 0, 0);
    S(p, 'head', 0.32 - 0.12 * sigh, -0.1 * sway, 0.08);
    S(p, 'leftShoulder', 0, -0.12, -0.1 + 0.08 * sigh);
    S(p, 'rightShoulder', 0, 0.12, 0.1 - 0.08 * sigh);
    leg(p, 1, 0.02, 0.01, 0.06, -0.04);
    leg(p, -1, 0.02, 0.01, 0.12, -0.08);
    arm(p, 1, -0.06, 1.32, 0, 0.35, 0.12);
    arm(p, -1, -0.06, 1.32, 0, 0.35, 0.14);
    hipsOff(p, 0.01 * sway * k, -0.02 * k, 0);
  }

  private poseThink(p: Pose) {
    this.poseIdle(p, 0.2);
    const t = this.t;
    const tilt = Math.sin(t * 0.45 + this.ph[7]!);
    arm(p, -1, -0.85, 1.42, 0, 0.45, 2.25);     // right hand to chin
    hand(p, -1, 0.35, 0.2);
    arm(p, 1, -0.3, 1.32, 0, 1.3, 1.55);         // left forearm across the belly (supports the elbow)
    hand(p, 1, 0.1, 0);
    A(p, 'spine', 0.02, 0.04, 0);
    S(p, 'neck', 0.02, -0.04, 0.04);
    S(p, 'head', 0.06 + 0.04 * tilt, -0.1 + 0.12 * tilt, 0.1 + 0.05 * tilt);
  }

  private poseLaugh(p: Pose) {
    this.poseIdle(p, 0.2);
    const t = this.t;
    const shake = Math.sin(t * TAU * 3.2), burst = 0.5 + 0.5 * Math.sin(t * 1.4);
    A(p, 'spine', 0.05 * burst, 0, 0);
    S(p, 'chest', -0.08 + 0.05 * shake * burst + 0.1 * burst, 0, 0.02 * shake);
    S(p, 'head', -0.25 + 0.2 * burst + 0.06 * shake, 0.05 * Math.sin(t * 0.9), 0.04 * shake);
    arm(p, 1, -0.3, 1.3, 0, 1.15, 1.45 + 0.08 * shake);
    arm(p, -1, -0.3, 1.3, 0, 1.15, 1.45 - 0.08 * shake);
    A(p, 'leftShoulder', 0, 0, 0.05 * pos(shake));
    A(p, 'rightShoulder', 0, 0, -0.05 * pos(shake));
    p[HO + 1] += -0.015 * burst * this.k;
  }

  private applyGesture(g: GestureState, p: Pose, scale: number) {
    const t = g.t, d = g.duration;
    const w = scale * envelope(t, d, 0.28, 0.4);
    if (w <= 0.0001) return;
    switch (g.name) {
      case 'wave': this.waveArm(p, t, w); break;
      case 'greet': {
        const osc = Math.sin(t * TAU * 2.4);
        armBL(p, -1, -0.45, 0.35, 0, -1.2, 1.9 + 0.25 * osc, w);
        BL(p, 'rightHand', 0, 0, 0.15 * osc, 0, w);
        const nod = Math.sin(clamp((t - 0.35) / 0.7, 0, 1) * Math.PI);
        A(p, 'head', 0.22 * nod * w, 0, 0.06 * w);
        break;
      }
      case 'bow': {
        const b = smooth01(t / 0.55) * smooth01((d - t) / 0.6);
        const ww = scale * b;
        BL(p, 'spine', 0.42, 0, 0, 0, ww);
        BL(p, 'chest', 0.22, 0, 0, 0, ww);
        BL(p, 'neck', 0.12, 0, 0, 0, ww);
        BL(p, 'head', 0.18, 0, 0, 0, ww);
        armBL(p, 1, -0.25, 1.38, 0, 0.6, 0.35, ww);
        armBL(p, -1, -0.25, 1.38, 0, 0.6, 0.35, ww);
        break;
      }
      case 'cheer': {
        const pump = Math.sin(t * TAU * 2.2);
        armBL(p, 1, -0.1, -1.0 + 0.15 * pump, 0, 0.3, 0.3 + 0.35 * pos(pump), w);
        armBL(p, -1, -0.1, -1.0 - 0.15 * pump, 0, 0.3, 0.3 + 0.35 * pos(-pump), w);
        BL(p, 'head', -0.18, 0, 0, 0, w);
        BL(p, 'chest', -0.06, 0, 0, 0, w);
        break;
      }
      case 'give': {
        const reach = smooth01(t / 0.6) * smooth01((d - t) / 0.5);
        const ww = scale * reach;
        BL(p, 'spine', p[IDX.spine]! + 0.12, p[IDX.spine + 1]!, p[IDX.spine + 2]!, 0, ww);
        armBL(p, 1, -1.0, 1.15, 0, 0.55, 0.55, ww);
        armBL(p, -1, -1.0, 1.15, 0, 0.55, 0.55, ww);
        BL(p, 'leftHand', 0, 0.3, 0, 0, ww); BL(p, 'rightHand', 0, -0.3, 0, 0, ww);
        break;
      }
      case 'nod': {
        A(p, 'head', 0.2 * w * Math.max(0, Math.sin(t * TAU * 1.8)), 0, 0);
        A(p, 'neck', 0.06 * w * Math.max(0, Math.sin(t * TAU * 1.8)), 0, 0);
        break;
      }
      case 'shake': {
        A(p, 'head', 0.06 * w, 0.32 * w * Math.sin(t * TAU * 2.4), 0);
        A(p, 'neck', 0, 0.1 * w * Math.sin(t * TAU * 2.4), 0);
        break;
      }
      case 'clap': {
        const c = 0.5 + 0.5 * Math.sin(t * TAU * 3);
        armBL(p, 1, -1.05, 1.05, 0, 1.05 + 0.18 * c, 1.7 + 0.2 * c, w);
        armBL(p, -1, -1.05, 1.05, 0, 1.05 + 0.18 * c, 1.7 + 0.2 * c, w);
        BL(p, 'leftHand', 0, 0, 0.2, 0, w); BL(p, 'rightHand', 0, 0, -0.2, 0, w);
        A(p, 'head', -0.05 * w, 0, 0);
        break;
      }
      case 'shrug': {
        const up = smooth01(t / 0.35) * smooth01((d - t) / 0.45);
        const ww = scale * up;
        A(p, 'leftShoulder', 0, 0, 0.22 * ww);
        A(p, 'rightShoulder', 0, 0, -0.22 * ww);
        armBL(p, 1, -0.35, 1.15, 0, -0.7, 1.35, ww);
        armBL(p, -1, -0.35, 1.15, 0, -0.7, 1.35, ww);
        BL(p, 'leftHand', 0, 0, -0.3, 0, ww); BL(p, 'rightHand', 0, 0, 0.3, 0, ww);
        A(p, 'head', -0.04 * ww, 0, 0.16 * ww);
        break;
      }
    }
  }

  private updateExpressions(dt: number, fadeW: number) {
    const cur = this.exprCur, mood = this.exprMood;
    familyMood(this.base, mood);
    // Blink.
    if (this.blinkT >= 0) { this.blinkT += dt; if (this.blinkT > 0.16) this.blinkT = -1; }
    else if ((this.nextBlink -= dt) <= 0) {
      this.blinkT = 0;
      this.nextBlink = this.rand() < 0.15 ? 0.25 : 2 + this.rand() * 4;
    }
    const blink = this.blinkT >= 0 ? Math.sin((this.blinkT / 0.16) * Math.PI) : 0;
    // Mouth flaps.
    if (this.talkingTimer > 0 && (this.talkingTimer -= dt) <= 0) this.talking = false;
    const talking = this.talking || this.base === 'talk' || this.base === 'laugh';
    let aa = 0, oh = 0;
    if (talking) {
      const t = this.t;
      if (this.base === 'laugh') aa = 0.35 + 0.45 * pos(Math.sin(t * TAU * 3.2));
      else {
        const syl = pos(Math.sin(t * 11.5 + this.ph[1]!)) * (0.55 + 0.45 * Math.sin(t * 3.3 + this.ph[2]!));
        const pause = this.noise(t * 0.7, 4) > -0.35 ? 1 : 0.1;
        aa = clamp(syl * pause * 0.75, 0, 1);
        oh = clamp(pos(Math.sin(t * 7.1 + this.ph[3]!)) * 0.35 * pause, 0, 1);
      }
    }
    const a = 1 - Math.exp(-dt * 12);
    for (let i = 0; i < NE; i++) {
      if (this.exprFlashT[i]! > 0) {
        this.exprFlashT[i] = this.exprFlashT[i]! - dt;
        if (this.exprFlashT[i]! <= 0) this.exprFlash[i] = 0;
      }
      let target = Math.max(mood[i]! * (0.4 + 0.6 * fadeW), this.exprManual[i]!, this.exprFlash[i]!);
      if (i === EXPR_INDEX.aa) target = Math.max(target, aa);
      else if (i === EXPR_INDEX.oh) target = Math.max(target, oh);
      if (i === EXPR_INDEX.blink) { cur[i] = Math.max(blink, target > cur[i]! ? cur[i]! + (target - cur[i]!) * a : target); }
      else if (i === EXPR_INDEX.aa || i === EXPR_INDEX.oh) cur[i] = cur[i]! + (target - cur[i]!) * (1 - Math.exp(-dt * 25));
      else cur[i] = cur[i]! + (target - cur[i]!) * a;
    }
    // Strong emotions suppress conflicting ones.
    const sad = cur[EXPR_INDEX.sad]!;
    if (sad > 0.3) cur[EXPR_INDEX.happy] = cur[EXPR_INDEX.happy]! * (1 - sad);
    for (let i = 0; i < NE; i++) {
      const v = cur[i]!;
      if (Math.abs(v - this.exprSent[i]!) > 0.004) { this.exprSent[i] = v; this.rig.setExpression(EXPRESSIONS[i]!, v); }
    }
  }
}

function applyPose(rig: HumanoidRig, p: Pose) {
  for (let i = 0; i < NB; i++) {
    const o = i * 4;
    _e.set(p[o]!, p[o + 1]!, p[o + 2]!, 'XYZ');
    _q.setFromEuler(_e);
    const tw = p[o + 3]!;
    if (tw !== 0) { _qt.setFromAxisAngle(_X, tw); _q.multiply(_qt); }
    rig.setBoneRotation(HUMAN_BONES[i]!, _q);
  }
  rig.setHipsOffset(p[HO]!, p[HO + 1]!, p[HO + 2]!);
}

/** Rest hip / knee heights (m above the feet) when the rig exposes canonical bone names. */
function measureLegs(rig: HumanoidRig): { hip: number; knee: number } | null {
  const r = rig as HumanoidRig & { hipsHeight?: number; kneeHeight?: number };
  if (typeof r.hipsHeight === 'number' && r.hipsHeight > 0) return { hip: r.hipsHeight, knee: r.kneeHeight ?? r.hipsHeight * 0.52 };
  try {
    const root = rig.root;
    const hips = root.getObjectByName('hips');
    const knee = root.getObjectByName('leftLowerLeg');
    if (!hips) return null;
    root.updateMatrixWorld(true);
    _v.setFromMatrixPosition(root.matrixWorld);
    _v2.setFromMatrixPosition(hips.matrixWorld);
    const hip = _v2.y - _v.y;
    let kn = hip * 0.52;
    if (knee) { _v2.setFromMatrixPosition(knee.matrixWorld); kn = _v2.y - _v.y; }
    return hip > 0.2 ? { hip, knee: kn } : null;
  } catch { return null; }
}
