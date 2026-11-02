/** Renders the batched town + small animated details (swings, pond, smoke, signs, lamp light pools). */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { PLAZA_RADIUS } from '../world/layout';
import { useKit } from './context';
import { patchWeather, type SceneKit } from './kit';
import { makeSignTexture, rng } from './batch';
import { buildTown, poiAt, POND, PLAYGROUND_SWINGS, swingGeometry, type SignDef, type TownOptions } from './town';
import { createWaterMaterial } from './water';

export interface TownProps {
  quality: 'low' | 'high';
  onLocationSelect?: (poiId: string) => void;
  /** Built-in forest belt / hills / rolling ground (default true). Turn off when an external landscape is mounted. */
  horizon?: boolean;
  /** STABLE (module-level) trees owned by another module; stylised trees keep clear of them. */
  reservedTrees?: TownOptions['reservedTrees'];
  /** STABLE footprint test of an external district. */
  occupied?: TownOptions['occupied'];
  /** STABLE external terrain sampler (used when horizon is false). */
  terrainAt?: TownOptions['terrainAt'];
}

export function Town({ quality, onLocationSelect, horizon = true, reservedTrees, occupied, terrainAt }: TownProps) {
  const kit = useKit();
  const town = useMemo(() => buildTown(quality, { horizon, reservedTrees, occupied, terrainAt }), [quality, horizon, reservedTrees, occupied, terrainAt]);
  useEffect(() => () => {
    for (const g of [town.solid, town.detail, town.far, town.flat, town.glass, town.bulbs, town.ground]) g.dispose();
  }, [town]);
  useEffect(() => {
    kit.occluders = town.occluders;
    return () => { if (kit.occluders === town.occluders) kit.occluders = []; };
  }, [kit, town]);

  const plaza = useMemo(() => {
    const tex = makePlazaTexture(kit);
    const mat = new THREE.MeshStandardMaterial({ map: tex, color: tex ? '#ffffff' : '#e6d8c0', roughness: 0.9 });
    patchWeather(mat, kit.uniforms, 0.9);
    const geo = new THREE.CircleGeometry(PLAZA_RADIUS, 96);
    geo.rotateX(-Math.PI / 2);
    return { tex, mat, geo };
  }, [kit]);
  useEffect(() => () => { plaza.tex?.dispose(); plaza.mat.dispose(); plaza.geo.dispose(); }, [plaza]);

  const clickPlane = useMemo(() => { const g = new THREE.PlaneGeometry(90, 90); g.rotateX(-Math.PI / 2); return g; }, []);
  useEffect(() => () => clickPlane.dispose(), [clickPlane]);

  useFrame(() => {
    const L = kit.env.lights;
    kit.glass.emissiveIntensity = 0.04 + L * 1.75;
    kit.bulbs.color.setScalar(0.62 + L * 2.9);
  });

  const onClick = onLocationSelect
    ? (e: ThreeEvent<MouseEvent>) => { const id = poiAt(e.point.x, e.point.z); if (id) onLocationSelect(id); }
    : undefined;

  return (
    <group>
      <mesh geometry={town.ground} material={kit.ground} receiveShadow />
      <mesh geometry={town.flat} material={kit.ground} receiveShadow />
      <mesh geometry={plaza.geo} material={plaza.mat} position={[0, 0.052, 0]} receiveShadow />
      <mesh geometry={town.solid} material={kit.solid} castShadow receiveShadow />
      <mesh geometry={town.detail} material={kit.solid} receiveShadow />
      <mesh geometry={town.far} material={kit.solid} />
      <mesh geometry={town.glass} material={kit.glass} receiveShadow />
      <mesh geometry={town.bulbs} material={kit.bulbs} />
      {onClick && <mesh geometry={clickPlane} position={[0, 0.06, 0]} visible={false} onClick={onClick} />}
      <LightPools lamps={town.lamps} />
      <Signs signs={town.signs} />
      <Swings />
      <Pond />
      <ChimneySmoke chimneys={town.chimneys} />
    </group>
  );
}

/* ----------------------------------------------------------- plaza tiles */

function makePlazaTexture(kit: SceneKit): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const S = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const R = PLAZA_RADIUS, px = S / (2 * R), cx = S / 2, cy = S / 2;
  const r = rng(77);
  ctx.fillStyle = '#c2b196';
  ctx.fillRect(0, 0, S, S);
  const stones = ['#ece2ce', '#e6d9c1', '#f1e8d8', '#ddcfb5', '#e8dcc6', '#f3ebde'];
  const accent = ['#dcae8e', '#d6a283', '#e1b598'];
  const edge = ['#cdb89a', '#c8b293', '#d3bfa2'];
  let rad = 2.3, ri = 0;
  const widths = [0.55, 0.62, 0.7, 0.72, 0.75, 0.78, 0.8, 0.8, 0.8, 0.8, 0.8];
  while (rad < R - 0.01) {
    const wdt = Math.min(widths[Math.min(ri, widths.length - 1)]!, R - rad);
    const mid = rad + wdt / 2;
    const isAccent = Math.abs(mid - 6.5) < 0.42;
    const isEdge = rad + wdt >= R - 0.05;
    const n = Math.max(10, Math.round((2 * Math.PI * mid) / (isEdge ? 0.7 : 0.95)));
    const off = r() * Math.PI * 2;
    const gap = 0.045 / mid;
    for (let k = 0; k < n; k++) {
      const a0 = off + (k / n) * Math.PI * 2 + gap, a1 = off + ((k + 1) / n) * Math.PI * 2 - gap;
      ctx.beginPath();
      ctx.arc(cx, cy, (rad + 0.04) * px, a0, a1);
      ctx.arc(cx, cy, (rad + wdt - 0.04) * px, a1, a0, true);
      ctx.closePath();
      const pal = isEdge ? edge : isAccent ? accent : stones;
      ctx.fillStyle = pal[Math.floor(r() * pal.length) % pal.length]!;
      ctx.fill();
    }
    rad += wdt; ri++;
  }
  // inner rosette under/around the fountain
  ctx.fillStyle = '#e4d3b6';
  ctx.beginPath(); ctx.arc(cx, cy, 2.3 * px, 0, Math.PI * 2); ctx.fill();
  // subtle speckle for texture
  for (let i = 0; i < 14000; i++) {
    ctx.fillStyle = r() < 0.5 ? `rgba(90,70,50,${(r() * 0.07).toFixed(3)})` : `rgba(255,255,255,${(r() * 0.08).toFixed(3)})`;
    ctx.fillRect(r() * S, r() * S, 2, 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  void kit;
  return tex;
}

/* ------------------------------------------------------------ light pools */

const POOL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const POOL_FRAG = /* glsl */ `
uniform float uI;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = pow(max(0.0, 1.0 - d), 2.0) * uI;
  gl_FragColor = vec4(uColor, a);
}`;

function LightPools({ lamps }: { lamps: THREE.Vector3[] }) {
  const kit = useKit();
  const ref = useRef<THREE.InstancedMesh>(null);
  const res = useMemo(() => {
    const geo = new THREE.CircleGeometry(0.5, 28);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      vertexShader: POOL_VERT, fragmentShader: POOL_FRAG, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2,
      uniforms: { uI: { value: 0 }, uColor: { value: new THREE.Color('#ffc477') } },
    });
    return { geo, mat };
  }, []);
  useEffect(() => () => { res.geo.dispose(); res.mat.dispose(); }, [res]);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const tmp = new THREE.Matrix4();
    lamps.forEach((l, i) => { tmp.makeScale(5.4, 1, 5.4).setPosition(l.x, 0.075, l.z); m.setMatrixAt(i, tmp); });
    m.instanceMatrix.needsUpdate = true;
  }, [lamps]);
  useFrame(() => {
    const L = kit.env.lights;
    res.mat.uniforms.uI!.value = L * 0.5;
    if (ref.current) ref.current.visible = L > 0.02;
  });
  if (!lamps.length) return null;
  return <instancedMesh ref={ref} args={[res.geo, res.mat, lamps.length]} frustumCulled={false} renderOrder={2} />;
}

/* ----------------------------------------------------------------- signs */

function Signs({ signs }: { signs: SignDef[] }) {
  const kit = useKit();
  const items = useMemo(() => signs.map(s => {
    const tex = makeSignTexture({ text: s.text, sub: s.sub, fg: s.fg, bg: s.bg, glow: s.glow, border: s.border, width: 512, height: Math.round(512 * (s.height / s.width)) || 128 });
    const geo = new THREE.PlaneGeometry(s.width, s.height);
    const mat: THREE.Material = s.neon
      ? new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false })
      : new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.8, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0, depthWrite: false });
    return { s, tex, geo, mat };
  }), [signs]);
  useEffect(() => () => { for (const i of items) { i.tex?.dispose(); i.geo.dispose(); i.mat.dispose(); } }, [items]);
  useFrame(() => {
    const L = kit.env.lights, t = kit.env.t;
    for (const it of items) {
      if (it.mat instanceof THREE.MeshBasicMaterial) it.mat.color.setScalar(1.0 + L * 2.4 + Math.sin(t * 9) * 0.05 * L);
      else if (it.mat instanceof THREE.MeshStandardMaterial) it.mat.emissiveIntensity = 0.05 + L * 0.95;
    }
  });
  return <>{items.map(it => it.tex && (
    <mesh key={it.s.key} geometry={it.geo} material={it.mat} position={it.s.position} rotation={[0, it.s.rotationY, 0]} renderOrder={3} />
  ))}</>;
}

/* ---------------------------------------------------------------- swings */

function Swings() {
  const kit = useKit();
  const geo = useMemo(() => swingGeometry(), []);
  useEffect(() => () => geo.dispose(), [geo]);
  const a = useRef<THREE.Mesh>(null), b = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const t = kit.env.t;
    if (a.current) a.current.rotation.x = Math.sin(t * 1.9) * 0.36;
    if (b.current) b.current.rotation.x = Math.sin(t * 1.65 + 1.3) * 0.18;
  });
  const S = PLAYGROUND_SWINGS;
  return (
    <group position={[S.x, 2.42, S.z]} rotation={[0, S.yaw, 0]}>
      <mesh ref={a} geometry={geo} material={kit.solid} position={[-0.72, 0, 0]} castShadow />
      <mesh ref={b} geometry={geo} material={kit.solid} position={[0.72, 0, 0]} castShadow />
    </group>
  );
}

/* ------------------------------------------------------------------ pond */

function Pond() {
  const kit = useKit();
  const res = useMemo(() => {
    const geo = new THREE.CircleGeometry(POND.r + 0.15, 40);
    geo.rotateX(-Math.PI / 2);
    const mat = createWaterMaterial(kit, POND, POND.r, 0.0);
    return { geo, mat };
  }, [kit]);
  useEffect(() => () => { res.geo.dispose(); res.mat.dispose(); }, [res]);
  useFrame(() => { res.mat.uniforms.uNight!.value = kit.env.lights * 0.35; });
  return <mesh geometry={res.geo} material={res.mat} position={[POND.x, 0.05, POND.z]} scale={[1, 1, 0.9]} />;
}

/* ---------------------------------------------------------- chimney smoke */

function ChimneySmoke({ chimneys }: { chimneys: THREE.Vector3[] }) {
  const kit = useKit();
  const PUFFS = 6;
  const ref = useRef<THREE.InstancedMesh>(null);
  const res = useMemo(() => {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: '#efece6', roughness: 1, transparent: true, opacity: 0.6, depthWrite: false });
    return { geo, mat };
  }, []);
  useEffect(() => () => { res.geo.dispose(); res.mat.dispose(); }, [res]);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3() }), []);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const env = kit.env;
    const amount = 0.25 + 0.75 * Math.max(env.lights, env.snow);
    chimneys.forEach((c, i) => {
      for (let k = 0; k < PUFFS; k++) {
        const ph = (env.t * 0.16 + k / PUFFS + i * 0.37) % 1;
        tmp.p.set(c.x + Math.sin(ph * 5 + i) * 0.18 + ph * 0.9, c.y + ph * 3.0, c.z + ph * 0.5);
        const sc = (0.16 + ph * 0.5) * (1 - smooth01(0.65, 1, ph)) * smooth01(0, 0.08, ph) * amount;
        tmp.s.setScalar(Math.max(0.0001, sc));
        tmp.m.compose(tmp.p, tmp.q, tmp.s);
        m.setMatrixAt(i * PUFFS + k, tmp.m);
      }
    });
    m.instanceMatrix.needsUpdate = true;
    const night = env.lights;
    res.mat.color.setRGB(0.93 - night * 0.45, 0.92 - night * 0.43, 0.9 - night * 0.38);
  });
  if (!chimneys.length) return null;
  return <instancedMesh ref={ref} args={[res.geo, res.mat, chimneys.length * PUFFS]} frustumCulled={false} />;
}

function smooth01(e0: number, e1: number, x: number) { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }
