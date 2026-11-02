/**
 * Body proportions for the 5 Townie presets × build, bone rest positions
 * (canonical T-pose frame, see ../rig.ts) and skin-weight functions.
 */
import { HUMAN_BONES, type HumanBoneName } from '../rig';
import { interpKeys, lerp, smooth, type SkinW, type V3 } from './geom';

export const BI = Object.fromEntries(HUMAN_BONES.map((b, i) => [b, i])) as Record<HumanBoneName, number>;

interface Preset {
  leg: number; torso: number; arm: number; shoulder: number; hip: number; girth: number;
  waist: number; chest: number; head: number; belly: number; neck: number; limb: number;
}
export const PRESETS: Record<string, Preset> = {
  'townie-classic': { leg: 1, torso: 1, arm: 1, shoulder: 1, hip: 1, girth: 1, waist: 1, chest: 1, head: 1, belly: 0, neck: 1, limb: 1 },
  'townie-sporty': { leg: 1.05, torso: 1.03, arm: 1.03, shoulder: 1.17, hip: 0.95, girth: 1.04, waist: 0.9, chest: 1.12, head: 0.95, belly: 0, neck: 1.12, limb: 1.12 },
  'townie-soft': { leg: 0.93, torso: 0.98, arm: 0.95, shoulder: 0.98, hip: 1.15, girth: 1.16, waist: 1.25, chest: 1.06, head: 1.05, belly: 0.75, neck: 1.0, limb: 1.14 },
  'townie-tall': { leg: 1.14, torso: 1.07, arm: 1.1, shoulder: 0.98, hip: 0.92, girth: 0.86, waist: 0.9, chest: 0.94, head: 0.95, belly: 0, neck: 1.18, limb: 0.86 },
  'townie-petite': { leg: 0.84, torso: 0.9, arm: 0.88, shoulder: 0.88, hip: 0.97, girth: 0.93, waist: 0.95, chest: 0.94, head: 1.1, belly: 0.1, neck: 0.88, limb: 0.92 },
};

export interface Dims {
  key: string;
  bones: Record<HumanBoneName, V3>;
  hips: number; spine: number; chest: number; upperChest: number; neck: number; head: number;
  armX: number; armY: number; upperArm: number; lowerArm: number; hand: number;
  hipX: number; hipJoint: number; upperLeg: number; lowerLeg: number; ankle: number;
  footLen: number; footW: number;
  headScale: number; neckR: number;
  /** torso keys: [s, halfWidth, frontDepth, backDepth, superellipse n, zCenter] with s = (y - hips) / T */
  torsoKeys: number[][]; T: number;
  /** arm radius keys [t (m from shoulder pivot), r] */
  armKeys: number[][];
  /** leg radius keys [t (m down from hip joint), r, xOffset] */
  legKeys: number[][];
  handScale: number;
  /** top of head (unscaled, metres) */
  top: number;
}

/** Quantised build steps (geometry is cached per step). */
export const BUILD_STEPS = 8;
export const quantBuild = (b: number) => Math.round(Math.min(1, Math.max(0, b)) * BUILD_STEPS) / BUILD_STEPS;

export function computeDims(presetId: string, buildIn: number): Dims {
  const P = PRESETS[presetId] ?? PRESETS['townie-classic']!;
  const build = quantBuild(buildIn);
  const g = lerp(0.82, 1.3, build) * P.girth;          // limb girth
  const tg = lerp(0.88, 1.2, build) * Math.sqrt(P.girth); // torso girth
  const belly = P.belly + Math.max(0, build - 0.55) * 1.4;
  const waist = P.waist * lerp(0.92, 1.12, build);

  const legLen = 0.8 * P.leg;
  const ankle = 0.072;
  const upperLeg = (legLen - ankle) * 0.515, lowerLeg = (legLen - ankle) * 0.485;
  const hipJoint = legLen;
  const hips = legLen + 0.05;
  const spine = hips + 0.075 * P.torso;
  const chest = spine + 0.125 * P.torso;
  const upperChest = chest + 0.115 * P.torso;
  const neck = upperChest + 0.125 * P.torso;
  const head = neck + 0.075 * P.neck;
  const T = neck - hips;
  const armY = upperChest + 0.088 * P.torso;
  const sh = P.shoulder * lerp(0.96, 1.05, build);
  const armX = 0.158 * sh;
  const upperArm = 0.245 * P.arm, lowerArm = 0.225 * P.arm, hand = 0.17 * P.arm;
  const hipX = 0.082 * P.hip * lerp(0.95, 1.06, build);
  const hs = P.head;
  const L = P.limb;

  const torsoKeys = [
    [-0.27, 0.095 * P.hip * tg, 0.075 * tg, 0.08 * tg, 2.2, 0],
    [-0.16, 0.146 * P.hip * tg, 0.096 * tg, 0.112 * tg, 2.3, 0],
    [0.0, 0.152 * P.hip * tg, 0.098 * tg + belly * 0.012, 0.104 * tg, 2.4, 0],
    [0.24, 0.13 * waist * tg, 0.09 * tg + belly * 0.045, 0.086 * tg, 2.4, 0.004 + belly * 0.012],
    [0.46, 0.142 * P.chest * tg, 0.098 * tg + belly * 0.03, 0.09 * tg, 2.5, 0.006 + belly * 0.008],
    [0.66, 0.152 * P.chest * Math.sqrt(sh) * tg, 0.106 * P.chest * tg, 0.094 * tg, 2.6, 0.008],
    [0.8, 0.152 * sh * tg, 0.1 * tg, 0.094 * tg, 2.7, 0.004],
    [0.92, 0.13 * sh * tg, 0.082 * tg, 0.084 * tg, 2.6, 0],
    [0.99, 0.085 * Math.sqrt(sh), 0.062, 0.066, 2.2, -0.004],
    [1.04, 0.05 * P.neck, 0.046, 0.048, 2.0, -0.006],
  ];
  const ua = upperArm, la = lowerArm;
  const armKeys = [
    [0.0, 0.05 * g * L], [0.07, 0.047 * g * L], [ua * 0.6, 0.041 * g * L], [ua, 0.035 * g],
    [ua + 0.05, 0.037 * g * L], [ua + la * 0.55, 0.032 * g], [ua + la, 0.026 * g],
  ];
  const ul = upperLeg, ll = lowerLeg;
  const legKeys = [
    [-0.02, 0.082 * g * Math.sqrt(P.hip), 0], [0.08, 0.077 * g * L, -0.002], [ul * 0.55, 0.066 * g * L, -0.008], [ul, 0.05 * g, -0.012],
    [ul + 0.08, 0.052 * g * L, -0.012], [ul + ll * 0.45, 0.046 * g, -0.01], [ul + ll * 0.85, 0.034 * g, -0.008], [ul + ll, 0.031 * g, -0.008],
  ];

  const bones: Record<HumanBoneName, V3> = {
    hips: [0, hips, 0], spine: [0, spine, 0], chest: [0, chest, 0], upperChest: [0, upperChest, 0],
    neck: [0, neck, -0.008], head: [0, head, -0.004],
    leftShoulder: [0.045, armY, -0.005], leftUpperArm: [armX, armY, -0.005], leftLowerArm: [armX + ua, armY, -0.005], leftHand: [armX + ua + la, armY, -0.005],
    rightShoulder: [-0.045, armY, -0.005], rightUpperArm: [-armX, armY, -0.005], rightLowerArm: [-armX - ua, armY, -0.005], rightHand: [-armX - ua - la, armY, -0.005],
    leftUpperLeg: [hipX, hipJoint, 0], leftLowerLeg: [hipX, hipJoint - ul, 0], leftFoot: [hipX, ankle, 0], leftToes: [hipX, 0.025, 0.13],
    rightUpperLeg: [-hipX, hipJoint, 0], rightLowerLeg: [-hipX, hipJoint - ul, 0], rightFoot: [-hipX, ankle, 0], rightToes: [-hipX, 0.025, 0.13],
  };
  const top = head + 0.24 * hs;
  return {
    key: `${presetId in PRESETS ? presetId : 'townie-classic'}:${build}`,
    bones, hips, spine, chest, upperChest, neck, head, armX, armY, upperArm, lowerArm, hand,
    hipX, hipJoint, upperLeg, lowerLeg, ankle, footLen: 0.235 * Math.sqrt(P.leg), footW: 0.088 * Math.sqrt(g),
    headScale: hs, neckR: 0.047 * P.neck * lerp(0.92, 1.15, build), torsoKeys, T, armKeys, legKeys,
    handScale: P.arm * lerp(0.94, 1.08, build), top,
  };
}

/** Torso cross-section at height y (absolute). Returns [halfWidth, frontDepth, backDepth, n, zc]. */
export function torsoAt(d: Dims, y: number): [number, number, number, number, number] {
  const s = (y - d.hips) / d.T;
  const k = d.torsoKeys;
  return [interpKeys(k, s, 1), interpKeys(k, s, 2), interpKeys(k, s, 3), interpKeys(k, s, 4), interpKeys(k, s, 5)];
}
export const torsoS = (d: Dims, s: number) => d.hips + s * d.T;
export const armR = (d: Dims, t: number) => interpKeys(d.armKeys, t, 1);
export const legR = (d: Dims, t: number) => interpKeys(d.legKeys, t, 1);
export const legDX = (d: Dims, t: number) => interpKeys(d.legKeys, t, 2);

// ---------------------------------------------------------------- weights
function setW(out: SkinW, pairs: Array<[number, number]>): void {
  let tot = 0; for (const p of pairs) tot += p[1];
  pairs.sort((a, b) => b[1] - a[1]);
  for (let i = 0; i < 4; i++) {
    const p = pairs[i];
    out.i[i] = p ? p[0] : 0; out.w[i] = p && tot > 0 ? p[1] / tot : (i === 0 && !p ? 1 : 0);
  }
}

/** Spine chain + leg blend at the bottom + shoulder blend at the top sides. */
export function torsoWeights(d: Dims) {
  const chain: Array<[number, number]> = [[BI.hips, d.hips], [BI.spine, d.spine], [BI.chest, d.chest], [BI.upperChest, d.upperChest], [BI.neck, d.neck]];
  return (x: number, y: number, _z: number, out: SkinW) => {
    const pairs: Array<[number, number]> = [];
    // spine chain: piecewise blend around each joint
    let wPrev = 1; let idxPrev = chain[0]![0];
    const acc = new Map<number, number>();
    for (let i = 1; i < chain.length; i++) {
      const [bi, jy] = chain[i]!;
      const blend = i === chain.length - 1 ? 0.025 : 0.05;
      const t = smooth(jy - blend, jy + blend, y);
      acc.set(idxPrev, (acc.get(idxPrev) ?? 0) + wPrev * (1 - t));
      wPrev = wPrev * t; idxPrev = bi;
    }
    acc.set(idxPrev, (acc.get(idxPrev) ?? 0) + wPrev);
    // legs: low vertices follow thighs
    const legT = smooth(d.hipJoint + 0.03, d.hipJoint - 0.07, y) * smooth(0.0, d.hipX * 0.9, Math.abs(x)) * 0.85;
    if (legT > 0.001) {
      for (const [k, v] of acc) acc.set(k, v * (1 - legT));
      acc.set(x > 0 ? BI.leftUpperLeg : BI.rightUpperLeg, legT);
    }
    for (const [k, v] of acc) if (v > 0.0005) pairs.push([k, v]);
    setW(out, pairs);
  };
}

/** Arm chain weights by |x| (side from sign of x). */
export function armWeights(d: Dims, upperBlend = 0.035) {
  return (x: number, _y: number, _z: number, out: SkinW) => {
    const left = x > 0; const ax = Math.abs(x);
    const sh = left ? BI.leftShoulder : BI.rightShoulder, ua = left ? BI.leftUpperArm : BI.rightUpperArm;
    const la = left ? BI.leftLowerArm : BI.rightLowerArm, ha = left ? BI.leftHand : BI.rightHand;
    const t = ax - d.armX;
    const w1 = smooth(-upperBlend - 0.02, upperBlend * 0.5, t); // shoulder -> upper arm
    const w2 = smooth(d.upperArm - 0.035, d.upperArm + 0.035, t); // upper -> lower
    const w3 = smooth(d.upperArm + d.lowerArm - 0.015, d.upperArm + d.lowerArm + 0.01, t); // lower -> hand
    const pairs: Array<[number, number]> = [];
    const base = 1 - w1;
    if (base > 0) { pairs.push([sh, base * 0.55]); pairs.push([BI.upperChest, base * 0.45]); }
    const uaw = w1 * (1 - w2); if (uaw > 0) pairs.push([ua, uaw]);
    const law = w1 * w2 * (1 - w3); if (law > 0) pairs.push([la, law]);
    const hw = w1 * w2 * w3; if (hw > 0) pairs.push([ha, hw]);
    setW(out, pairs);
  };
}

/** Leg chain weights by y (side from sign of x). */
export function legWeights(d: Dims) {
  return (x: number, y: number, _z: number, out: SkinW) => {
    const left = x > 0;
    const ul = left ? BI.leftUpperLeg : BI.rightUpperLeg, ll = left ? BI.leftLowerLeg : BI.rightLowerLeg, ft = left ? BI.leftFoot : BI.rightFoot;
    const t = d.hipJoint - y;
    const w0 = smooth(-0.06, 0.03, t); // hips -> upper leg
    const w1 = smooth(d.upperLeg - 0.04, d.upperLeg + 0.04, t);
    const w2 = smooth(d.upperLeg + d.lowerLeg - 0.02, d.upperLeg + d.lowerLeg + 0.01, t);
    const pairs: Array<[number, number]> = [];
    if (1 - w0 > 0) pairs.push([BI.hips, 1 - w0]);
    const a = w0 * (1 - w1); if (a > 0) pairs.push([ul, a]);
    const b = w0 * w1 * (1 - w2); if (b > 0) pairs.push([ll, b]);
    const c = w0 * w1 * w2; if (c > 0) pairs.push([ft, c]);
    setW(out, pairs);
  };
}

/** Skirt weights: hips, with the lower front/back following the thighs a bit. */
export function skirtWeights(d: Dims, length: number) {
  return (x: number, y: number, _z: number, out: SkinW) => {
    const t = Math.min(1, Math.max(0, (d.hipJoint + 0.06 - y) / Math.max(0.05, length)));
    const k = 0.62 * Math.pow(t, 1.3);
    const side = Math.max(-1, Math.min(1, x / (d.hipX * 1.6)));
    const wl = k * (0.5 + side * 0.5), wr = k * (0.5 - side * 0.5);
    setW(out, [[BI.hips, 1 - k], [BI.leftUpperLeg, wl], [BI.rightUpperLeg, wr]]);
  };
}
