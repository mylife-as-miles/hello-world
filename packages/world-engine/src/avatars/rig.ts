/**
 * HumanoidRig — the seam between avatar construction (src/avatars, src/creator)
 * and animation/interaction (src/interactions). Both the procedural "Townie"
 * rig and the VRM adapter implement this interface, so every animation works
 * on every avatar.
 *
 * CANONICAL FRAME (identical to three-vrm VRM 1.0 *normalized* humanoid bones):
 *  - Rest pose is a T-pose: arms straight out along ±X, legs straight down.
 *  - At rest every bone has an IDENTITY local rotation and its local axes are
 *    aligned with the rig root's axes.
 *  - The character faces +Z, up is +Y, the character's LEFT side is +X.
 *  - Feet rest on y = 0 of `root`.
 * Useful sign conventions (radians, Euler XYZ on the bone's local rotation):
 *  - Arms down at sides: leftUpperArm z ≈ -1.25, rightUpperArm z ≈ +1.25
 *  - Raise right arm overhead: rightUpperArm z ≈ -1.2 (mirror for left: +1.2)
 *  - Elbow bend (forearm forward): leftLowerArm y < 0, rightLowerArm y > 0
 *  - Hip flexion (leg swings forward): upperLeg x < 0; knee bend: lowerLeg x > 0
 *  - Head nod down: head x > 0; look left: head y > 0
 *  - Spine lean forward: spine x > 0
 * The VRM adapter converts this frame for VRM 0.x models internally.
 */
import type { Object3D, Quaternion } from 'three';

export const HUMAN_BONES = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
] as const;
export type HumanBoneName = typeof HUMAN_BONES[number];

export const EXPRESSIONS = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'relaxed', 'blink', 'aa', 'oh'] as const;
export type ExpressionName = typeof EXPRESSIONS[number];

export type AttachSlot = 'head' | 'leftHand' | 'rightHand' | 'back';

export interface HumanoidRig {
  /** Add this to the scene. Feet at y=0, facing +Z. */
  readonly root: Object3D;
  readonly kind: 'procedural' | 'vrm' | 'realistic';
  /** Approximate standing height in meters (top of head), after body scaling. */
  readonly height: number;
  /** Set a bone's local rotation relative to the T-pose rest (canonical frame). Missing bones are ignored. */
  setBoneRotation(bone: HumanBoneName, rotation: Quaternion): void;
  /** Translate hips from their rest position (canonical frame, meters). Used for bounce/crouch/sit. */
  setHipsOffset(x: number, y: number, z: number): void;
  /** Facial expression weight 0–1. Unsupported expressions are a no-op. */
  setExpression(name: ExpressionName, weight: number): void;
  /** Object3D that follows a body part, for props (gift box, coffee cup). May be null. */
  getAttachPoint(slot: AttachSlot): Object3D | null;
  /** Call once per frame AFTER posing (VRM: springs/expressions; procedural: face). */
  update(dt: number): void;
  /** Free GPU resources. The rig must not be used afterwards. */
  dispose(): void;
}

/** Level of detail requested by the renderer. 'low' = cheap distant avatar. */
export type AvatarLod = 'high' | 'low';
