/**
 * Live 3D studio preview for the AvatarCreator: its own R3F <Canvas> with
 * studio lighting (key/fill/rim + Lightformer environment, no network),
 * a turntable pedestal with contact shadows, clamped OrbitControls, smooth
 * camera presets, and the avatar rig posed by AvatarAnimator.
 *
 * Re-render discipline: the rig is rebuilt only when `appearanceKey` changes
 * (debounced ~60 ms while dragging) and the previous rig stays visible until
 * the new one is ready. Everything per-frame lives in refs + useFrame.
 */
import { memo, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { AvatarAppearance } from '@hello-world/contracts';
import { loadAvatarRig, type ExpressionName, type HumanoidRig } from '../avatars';
import { AvatarAnimator, type GestureName } from '../interactions/animation/AvatarAnimator';
import type { AnimationFamily } from '../world/activities';

export type CameraPreset = 'full' | 'upper' | 'face';
export type PreviewExpression = 'happy' | 'sad' | 'angry' | 'surprised' | 'relaxed' | 'blink';
export type PreviewBase = Extract<AnimationFamily, 'idle' | 'dance' | 'walk'>;

export interface PreviewCommand<T extends string> { name: T; nonce: number }

export interface CreatorPreviewProps {
  appearance: AvatarAppearance;
  appearanceKey: string;
  camera: CameraPreset;
  cameraNonce: number;
  autoRotate: boolean;
  base: PreviewBase;
  gesture: PreviewCommand<GestureName> | null;
  expression: PreviewCommand<PreviewExpression> | null;
  accent: string;
  /** Called (outside React render) when a rig is swapped in. */
  onRigReady?: (rig: HumanoidRig) => void;
  /** DOM node toggled while a rig is loading (no React re-render). */
  loadingEl?: React.RefObject<HTMLElement | null>;
}

const EXPRESSION_HOLD = 1.8;

/** Per-preset framing. Distances are fitted to the vertical fov at runtime. */
function presetGoal(preset: CameraPreset, h: number, fovDeg: number, aspect: number) {
  const tan = Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2);
  // visible height wanted, and target height on the body
  const spec = preset === 'face'
    ? { span: 0.5 * (h / 1.75), ty: h * 0.9, phi: 1.5, theta: 0.12 }
    : preset === 'upper'
      ? { span: 1.12 * (h / 1.75), ty: h * 0.72, phi: 1.47, theta: 0.28 }
      : { span: h * 1.3 + 0.12, ty: h * 0.5 + 0.02, phi: 1.43, theta: 0.42 };
  // In narrow viewports also fit the width (arms + a little air).
  const widthSpan = preset === 'full' ? 1.25 : preset === 'upper' ? 0.95 : 0.42;
  const dist = Math.max(spec.span / 2 / tan, widthSpan / 2 / (tan * Math.max(0.3, aspect)));
  return { targetY: spec.ty, dist, phi: spec.phi, theta: spec.theta };
}

function makeGlowTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (!g) return null;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface OrbitLike { target: THREE.Vector3; update(): void }

function Studio(props: CreatorPreviewProps) {
  const { appearance, appearanceKey, camera: preset, cameraNonce, autoRotate, base, gesture, expression, accent, onRigReady, loadingEl } = props;
  const turntable = useRef<THREE.Group>(null);
  const holder = useRef<THREE.Group>(null);
  const controls = useRef<OrbitLike | null>(null);
  const rigRef = useRef<HumanoidRig | null>(null);
  const animRef = useRef<AvatarAnimator | null>(null);
  const baseRef = useRef<PreviewBase>(base);
  const autoRef = useRef(autoRotate);
  const rigHeight = useRef(1.75);
  const camAnim = useRef(true);
  const presetRef = useRef<CameraPreset>(preset);
  const elapsed = useRef(0);
  const gestureRef = useRef<{ name: GestureName; until: number } | null>(null);
  // Expression envelopes: weight eases toward target; target drops to 0 after the hold.
  const exprs = useRef(new Map<ExpressionName, { w: number; target: number; until: number; blinkT?: number }>());
  const { camera, size } = useThree();
  const tmp = useMemo(() => ({ off: new THREE.Vector3(), sph: new THREE.Spherical() }), []);
  const glow = useMemo(() => makeGlowTexture(), []);
  useEffect(() => () => { glow?.dispose(); }, [glow]);

  autoRef.current = autoRotate;

  // ---- rig lifecycle -------------------------------------------------------
  const appearanceRef = useRef(appearance);
  appearanceRef.current = appearance;
  useEffect(() => {
    let cancelled = false;
    const first = !rigRef.current;
    const showLoading = window.setTimeout(() => loadingEl?.current?.classList.add('is-on'), first ? 0 : 220);
    const timer = window.setTimeout(() => {
      void loadAvatarRig(appearanceRef.current, { lod: 'high' }).then(rig => {
        if (cancelled || !holder.current) { rig.dispose(); return; }
        window.clearTimeout(showLoading);
        loadingEl?.current?.classList.remove('is-on');
        const old = rigRef.current;
        if (old) { holder.current.remove(old.root); old.dispose(); }
        rig.root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
        holder.current.add(rig.root);
        rigRef.current = rig;
        rigHeight.current = Number.isFinite(rig.height) && rig.height > 0.3 ? rig.height : 1.75;
        const anim = new AvatarAnimator(rig, 7);
        anim.setBase(baseRef.current);
        const g = gestureRef.current;
        if (g && g.until > elapsed.current) anim.playGesture(g.name, { duration: g.until - elapsed.current });
        anim.update(1 / 60); // pose before first paint (no T-pose flash)
        animRef.current = anim;
        // re-apply live expression weights on the fresh rig
        for (const [name, e] of exprs.current) anim.setExpression(name, e.w);
        onRigReady?.(rig);
      });
    }, first ? 0 : 60);
    return () => { cancelled = true; window.clearTimeout(timer); window.clearTimeout(showLoading); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appearanceKey]);

  useEffect(() => () => {
    rigRef.current?.dispose();
    rigRef.current = null;
    animRef.current = null;
  }, []);

  // ---- animation commands --------------------------------------------------
  useEffect(() => { baseRef.current = base; animRef.current?.setBase(base); }, [base]);
  useEffect(() => {
    if (!gesture) return;
    const duration = 2.6;
    gestureRef.current = { name: gesture.name, until: elapsed.current + duration };
    animRef.current?.playGesture(gesture.name, { duration });
  }, [gesture]);
  useEffect(() => {
    if (!expression) return;
    const map = exprs.current;
    for (const e of map.values()) { e.target = 0; e.until = 0; }
    if (expression.name === 'blink') {
      const prev = map.get('blink');
      map.set('blink', { w: prev?.w ?? 0, target: 0, until: 0, blinkT: 0 });
    } else {
      const name = expression.name as ExpressionName;
      const prev = map.get(name);
      map.set(name, { w: prev?.w ?? 0, target: 1, until: elapsed.current + 0.3 + EXPRESSION_HOLD });
    }
  }, [expression]);

  // ---- camera presets ------------------------------------------------------
  useEffect(() => { presetRef.current = preset; camAnim.current = true; }, [preset, cameraNonce]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    elapsed.current += dt;
    const now = elapsed.current;
    if (autoRef.current && turntable.current) turntable.current.rotation.y += dt * 0.5;

    // camera: target height always follows the body; full move only while animating a preset
    const c = controls.current;
    if (c) {
      const persp = camera as THREE.PerspectiveCamera;
      const goal = presetGoal(presetRef.current, rigHeight.current, persp.fov ?? 28, size.width / Math.max(1, size.height));
      const k = 1 - Math.exp(-dt * 5.5);
      const dy = (goal.targetY - c.target.y) * k;
      c.target.y += dy;
      camera.position.y += dy;
      if (camAnim.current) {
        tmp.off.copy(camera.position).sub(c.target);
        tmp.sph.setFromVector3(tmp.off);
        const dTheta = Math.atan2(Math.sin(goal.theta - tmp.sph.theta), Math.cos(goal.theta - tmp.sph.theta));
        tmp.sph.radius += (goal.dist - tmp.sph.radius) * k;
        tmp.sph.phi += (goal.phi - tmp.sph.phi) * k;
        tmp.sph.theta += dTheta * k;
        tmp.off.setFromSpherical(tmp.sph);
        camera.position.copy(c.target).add(tmp.off);
        if (Math.abs(goal.dist - tmp.sph.radius) < 0.003 && Math.abs(goal.phi - tmp.sph.phi) < 0.002 && Math.abs(dTheta) < 0.002
          && Math.abs(goal.targetY - c.target.y) < 0.003) camAnim.current = false;
      }
      camera.lookAt(c.target);
    }

    const rig = rigRef.current;
    const anim = animRef.current;
    if (!rig || !anim) return;
    // Expressions go through the animator's manual channel (it blends them with
    // its own moods/auto-blink and forwards to rig.setExpression in update()).
    for (const [name, e] of exprs.current) {
      if (e.blinkT !== undefined) {
        e.blinkT += dt;
        const t = e.blinkT;
        // playful double blink: close 0.1s, hold 0.1s, open 0.12s, repeat once
        const one = (x: number) => (x < 0 ? 0 : x < 0.1 ? x / 0.1 : x < 0.2 ? 1 : x < 0.32 ? 1 - (x - 0.2) / 0.12 : 0);
        e.w = Math.max(one(t), one(t - 0.46));
        anim.setExpression(name, e.w);
        if (t > 0.85) { anim.setExpression(name, 0); exprs.current.delete(name); }
        continue;
      }
      if (e.target > 0 && now > e.until) e.target = 0;
      const rate = e.target > e.w ? 7 : 4.5;
      e.w += (e.target - e.w) * (1 - Math.exp(-dt * rate));
      if (e.target === 0 && e.w < 0.01) { anim.setExpression(name, 0); exprs.current.delete(name); continue; }
      anim.setExpression(name, e.w);
    }
    if (gestureRef.current && now > gestureRef.current.until) gestureRef.current = null;
    anim.update(dt);
  });

  const accentColor = useMemo(() => new THREE.Color(accent), [accent]);

  return (
    <>
      <hemisphereLight args={['#e9e4ff', '#2a2238', 0.55]} />
      <directionalLight position={[2.6, 4.2, 3.4]} intensity={2.3} color="#fff1e2" />
      <directionalLight position={[-3.2, 2.2, 2.4]} intensity={0.75} color="#cfd9ff" />
      <directionalLight position={[-0.8, 3.2, -4]} intensity={2.4} color={accentColor} />
      <directionalLight position={[1.8, 1.4, -3]} intensity={1.1} color="#ffd2e6" />
      <Environment resolution={128} frames={1} environmentIntensity={0.7}>
        <Lightformer form="rect" intensity={2.2} color="#ffffff" position={[0, 5, 2]} rotation-x={Math.PI / 2} scale={[6, 3, 1]} />
        <Lightformer form="rect" intensity={1.4} color="#ffe8d6" position={[4, 1.5, 2]} rotation-y={-Math.PI / 2.4} scale={[2.5, 4, 1]} />
        <Lightformer form="rect" intensity={1.1} color="#d6dcff" position={[-4, 1.5, 2]} rotation-y={Math.PI / 2.4} scale={[2.5, 4, 1]} />
        <Lightformer form="ring" intensity={1.6} color={accent} position={[0, 2, -4]} scale={2.5} />
      </Environment>

      <group ref={turntable} rotation-y={-0.32}>
        <group ref={holder} />
        {/* pedestal */}
        <mesh position-y={-0.045} receiveShadow>
          <cylinderGeometry args={[1.12, 1.18, 0.09, 72]} />
          <meshPhysicalMaterial color="#2b2840" roughness={0.38} metalness={0.15} clearcoat={0.7} clearcoatRoughness={0.25} />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} position-y={0.0015}>
          <ringGeometry args={[1.06, 1.1, 96]} />
          <meshBasicMaterial color={accent} transparent opacity={0.85} toneMapped={false} />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} position-y={0.0012}>
          <ringGeometry args={[0.62, 0.628, 96]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.12} toneMapped={false} />
        </mesh>
      </group>
      {glow && (
        <mesh rotation-x={-Math.PI / 2} position-y={0.002} renderOrder={1}>
          <planeGeometry args={[2.6, 2.6]} />
          <meshBasicMaterial map={glow} color={accent} transparent opacity={0.22} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </mesh>
      )}
      <mesh rotation-x={-Math.PI / 2} position-y={-0.09}>
        <ringGeometry args={[1.5, 1.515, 128]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.08} toneMapped={false} />
      </mesh>
      <ContactShadows position={[0, 0.003, 0]} scale={2.6} resolution={512} blur={2.4} far={1.8} opacity={0.62} color="#0b0816" />

      <OrbitControls
        ref={controls as never}
        makeDefault
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.7}
        zoomSpeed={0.8}
        minDistance={0.55}
        maxDistance={7}
        minPolarAngle={0.35}
        maxPolarAngle={1.62}
        target={[0, 0.9, 0]}
        onStart={() => { camAnim.current = false; }}
      />
    </>
  );
}

function CreatorPreviewImpl(props: CreatorPreviewProps) {
  return (
    <Canvas
      className="hwc-canvas"
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: false }}
      camera={{ fov: 28, near: 0.05, far: 60, position: [1.6, 1.2, 4.6] }}
      onCreated={({ gl, scene }) => { gl.setClearColor(0x000000, 0); scene.background = null; }}
    >
      <Studio {...props} />
    </Canvas>
  );
}

/** Memoised: only re-renders when the appearance key or a preview command changes. */
export const CreatorPreview = memo(CreatorPreviewImpl, (a, b) =>
  a.appearanceKey === b.appearanceKey && a.camera === b.camera && a.cameraNonce === b.cameraNonce
  && a.autoRotate === b.autoRotate && a.base === b.base && a.gesture === b.gesture && a.expression === b.expression
  && a.accent === b.accent && a.onRigReady === b.onRigReady);
