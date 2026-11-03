/**
 * Frame-rate independent resident motion (pure, Node-safe).
 *
 * The drawn avatar chases its latest snapshot location. Movement is integrated with the REAL elapsed frame
 * time (bounded by MAX_MOTION_DT), sub-stepped at MOTION_SUBSTEP so the catch-up controller behaves the same
 * at 1 fps as at 60 fps. A resident that still trails its target far beyond the normal interpolation lag for
 * longer than LAG_SNAP_AFTER seconds snaps to it, so the drawn position never lags far behind the simulation.
 */

/** Longest real frame time integrated in one frame (s). Longer stalls (tab hidden, GC) are dropped. */
export const MAX_MOTION_DT = 1;
/** Sub-step for the catch-up controller (s): at ≥ 10 fps a frame is a single step, exactly as before. */
export const MOTION_SUBSTEP = 0.1;
/** Excess trail (m) beyond the expected interpolation lag that counts as "lagging". */
export const LAG_SNAP_DISTANCE = 1.5;
/** How long (s) a resident may lag by more than LAG_SNAP_DISTANCE before it snaps to its target. */
export const LAG_SNAP_AFTER = 1;

export interface MotionState {
  x: number;
  z: number;
  /** Seconds spent lagging by more than LAG_SNAP_DISTANCE (beyond the expected lag). */
  lagT: number;
}

export interface MotionStepResult {
  /** Distance walked this frame (m); excludes a snap. */
  moved: number;
  /** Integrated time (s) — the bounded real frame time. */
  dt: number;
  /** True when the resident was snapped onto its goal (lag or teleport). */
  snapped: boolean;
}

/** Bounded real frame time used for movement / facing. */
export function motionDt(delta: number): number {
  return delta > 0 ? Math.min(delta, MAX_MOTION_DT) : 0;
}

/**
 * Advances `s` toward (gx, gz). `estSpeed` = estimated sim walking speed (m/s), `intervalS` = snapshot interval (s),
 * `delta` = real frame time (s), `teleport` = distance beyond which the resident jumps immediately.
 */
export function stepMotion(
  s: MotionState, gx: number, gz: number, estSpeed: number, intervalS: number, delta: number, teleport: number,
  out: MotionStepResult = { moved: 0, dt: 0, snapped: false },
): MotionStepResult {
  const dt = motionDt(delta);
  out.moved = 0; out.dt = dt; out.snapped = false;
  let dx = gx - s.x, dz = gz - s.z;
  let dist = Math.hypot(dx, dz);
  if (dist > teleport) {
    s.x = gx; s.z = gz; s.lagT = 0; out.snapped = true;
    return out;
  }
  const lagTarget = estSpeed * intervalS;
  let left = dt;
  while (left > 1e-6 && dist > 0.005) {
    const h = Math.min(MOTION_SUBSTEP, left);
    left -= h;
    const catchUp = estSpeed > 0.2 ? Math.min(1.6, Math.max(0.75, 1 + (dist - lagTarget) / Math.max(0.4, lagTarget * 2))) : 1;
    const want = Math.max(estSpeed * catchUp, Math.min(1.4, dist * 2.2));
    const step = Math.min(dist, want * h);
    s.x += (dx / dist) * step; s.z += (dz / dist) * step;
    out.moved += step;
    dx = gx - s.x; dz = gz - s.z;
    dist = Math.hypot(dx, dz);
  }
  // Lag guard: trailing well beyond the normal interpolation lag for too long → snap cleanly onto the goal.
  if (dist - lagTarget > LAG_SNAP_DISTANCE) {
    s.lagT += dt;
    if (s.lagT > LAG_SNAP_AFTER) {
      s.x = gx; s.z = gz; s.lagT = 0; out.snapped = true;
    }
  } else s.lagT = 0;
  return out;
}
