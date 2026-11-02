/**
 * Day/night + weather controller. Runs first each frame (priority −2), reads
 * store.current (no React state), and drives: sun/moon key light (single
 * shadow caster), hemisphere + ambient fill, fog, sky uniforms, cloud tint,
 * ≤5 night point lights, shared snow/wet uniforms and kit.env.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useSceneStore } from '../core/SceneContext';
import { worldClock } from '../world/time';
import { useKit } from './context';
import type { SkyUniforms } from './Sky';

interface Key { h: number; top: string; hor: string; sun: string; sunI: number; hs: string; hg: string; hI: number; fog: string; cloud: string }
const KEYS_RAW: Key[] = [
  { h: 0, top: '#0b1431', hor: '#1f2b4f', sun: '#9fb2ff', sunI: 0.55, hs: '#3c4f86', hg: '#1c1f2e', hI: 0.62, fog: '#1c2646', cloud: '#2e3756' },
  { h: 4.6, top: '#0e1838', hor: '#27335e', sun: '#9fb2ff', sunI: 0.5, hs: '#3d5088', hg: '#1e2130', hI: 0.58, fog: '#202a4c', cloud: '#323b5c' },
  { h: 6.0, top: '#3e5592', hor: '#f2a57c', sun: '#ffb27a', sunI: 1.0, hs: '#a5acd8', hg: '#5c4b40', hI: 0.7, fog: '#d9a48d', cloud: '#f2b9a2' },
  { h: 7.6, top: '#73ace3', hor: '#ffdcb6', sun: '#ffd9a8', sunI: 2.6, hs: '#d2e2ff', hg: '#8a7a5a', hI: 0.95, fog: '#f2dfc9', cloud: '#fff1e2' },
  { h: 12.5, top: '#5aa2e8', hor: '#d2ebf8', sun: '#fff4e2', sunI: 3.3, hs: '#d9ecff', hg: '#8f9c62', hI: 1.08, fog: '#cfe6f3', cloud: '#ffffff' },
  { h: 16.6, top: '#64a3e0', hor: '#e4eeee', sun: '#ffe8c4', sunI: 3.0, hs: '#dae9ff', hg: '#969160', hI: 1.0, fog: '#dde8e8', cloud: '#fffaf0' },
  { h: 18.7, top: '#6c8fd5', hor: '#ffc07c', sun: '#ffb064', sunI: 2.5, hs: '#f2d2bd', hg: '#8c6b4a', hI: 0.9, fog: '#f4c59d', cloud: '#ffd2a8' },
  { h: 19.7, top: '#3d4e95', hor: '#f08c66', sun: '#ff8c52', sunI: 1.2, hs: '#b9a2c8', hg: '#5b4141', hI: 0.75, fog: '#c88c7c', cloud: '#e59a8f' },
  { h: 20.7, top: '#17214c', hor: '#5b4b7a', sun: '#9fb2ff', sunI: 0.55, hs: '#4c5289', hg: '#262432', hI: 0.62, fog: '#2f345b', cloud: '#3e4166' },
  { h: 24, top: '#0b1431', hor: '#1f2b4f', sun: '#9fb2ff', sunI: 0.55, hs: '#3c4f86', hg: '#1c1f2e', hI: 0.62, fog: '#1c2646', cloud: '#2e3756' },
];
interface CKey { h: number; top: THREE.Color; hor: THREE.Color; sun: THREE.Color; sunI: number; hs: THREE.Color; hg: THREE.Color; hI: number; fog: THREE.Color; cloud: THREE.Color }
const KEYS: CKey[] = KEYS_RAW.map(k => ({ h: k.h, sunI: k.sunI, hI: k.hI, top: new THREE.Color(k.top), hor: new THREE.Color(k.hor), sun: new THREE.Color(k.sun), hs: new THREE.Color(k.hs), hg: new THREE.Color(k.hg), fog: new THREE.Color(k.fog), cloud: new THREE.Color(k.cloud) }));
const GOLDEN = KEYS[6]!;

interface Look { top: THREE.Color; hor: THREE.Color; sun: THREE.Color; sunI: number; hs: THREE.Color; hg: THREE.Color; hI: number; fog: THREE.Color; cloud: THREE.Color }
const newLook = (): Look => ({ top: new THREE.Color(), hor: new THREE.Color(), sun: new THREE.Color(), sunI: 1, hs: new THREE.Color(), hg: new THREE.Color(), hI: 1, fog: new THREE.Color(), cloud: new THREE.Color() });

function sampleKeys(hours: number, out: Look): Look {
  let i = 0;
  while (i < KEYS.length - 2 && hours >= KEYS[i + 1]!.h) i++;
  const a = KEYS[i]!, b = KEYS[i + 1]!;
  const t = Math.min(1, Math.max(0, (hours - a.h) / (b.h - a.h || 1)));
  out.top.copy(a.top).lerp(b.top, t); out.hor.copy(a.hor).lerp(b.hor, t); out.sun.copy(a.sun).lerp(b.sun, t);
  out.hs.copy(a.hs).lerp(b.hs, t); out.hg.copy(a.hg).lerp(b.hg, t); out.fog.copy(a.fog).lerp(b.fog, t); out.cloud.copy(a.cloud).lerp(b.cloud, t);
  out.sunI = a.sunI + (b.sunI - a.sunI) * t; out.hI = a.hI + (b.hI - a.hI) * t;
  return out;
}

const C = (h: string) => new THREE.Color(h);
const RAIN = { topD: C('#6e7d8c'), topN: C('#1b2333'), horD: C('#a6b0b8'), horN: C('#283040'), cloudD: C('#8d97a1'), cloudN: C('#2a3140'), hsD: C('#b8c4cf'), hsN: C('#3a4560') };
const SNOW = { topD: C('#a9b9cc'), topN: C('#202a42'), horD: C('#e2e8ee'), horN: C('#30395a'), cloudD: C('#f2f4f7'), cloudN: C('#3a4258'), hsD: C('#e8f0ff'), hsN: C('#46507a') };
const tmpA = new THREE.Color(), tmpB = new THREE.Color();

export const NIGHT_LIGHTS: Array<{ pos: [number, number, number]; color: string; intensity: number; distance: number }> = [
  { pos: [0, 1.2, 0], color: '#9fe6ff', intensity: 7, distance: 9 },
  { pos: [10.6, 2.6, -6.6], color: '#ffc886', intensity: 12, distance: 12 },
  { pos: [7.5, 3.0, 7], color: '#ffb0d2', intensity: 10, distance: 10 },
  { pos: [0.5, 3.4, 13.2], color: '#ffd29a', intensity: 9, distance: 15 },
  { pos: [17.6, 2.6, -15.8], color: '#ff79d6', intensity: 8, distance: 10 },
];

export interface AtmosphereProps {
  transparent: boolean;
  quality: 'low' | 'high';
  sky: SkyUniforms;
  cloudTint: THREE.Color;
}

export function Atmosphere({ transparent, quality, sky, cloudTint }: AtmosphereProps) {
  const kit = useKit();
  const store = useSceneStore();
  const scene = useThree(s => s.scene);
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const amb = useRef<THREE.AmbientLight>(null);
  const points = useRef<Array<THREE.PointLight | null>>([]);
  const fog = useMemo(() => new THREE.Fog('#cfe6f3', 70, 230), []);
  const look = useMemo(newLook, []);
  const golden = useMemo(newLook, []);
  const tmp = useMemo(() => ({ sunDir: new THREE.Vector3(), sunUp: new THREE.Vector3(), moon: new THREE.Vector3(), gold: new THREE.Vector3(), key: new THREE.Vector3(), target: new THREE.Vector3(0, 0, -2) }), []);

  useEffect(() => {
    if (transparent) { scene.fog = null; scene.background = null; return; }
    scene.fog = fog;
    return () => { scene.fog = null; };
  }, [scene, fog, transparent]);

  useEffect(() => {
    const l = sun.current;
    if (!l) return;
    l.target.position.copy(tmp.target);
    scene.add(l.target);
    return () => { scene.remove(l.target); };
  }, [scene, tmp]);

  useFrame((state, rawDt) => {
    // Exponential smoothing is stable for any step; cap only absurd gaps (tab switches).
    const dt = Math.min(rawDt, 2);
    const env = kit.env;
    env.t = state.clock.elapsedTime;
    kit.uniforms.uTime.value = env.t;
    const snap = store.current;
    const extra = Math.min(1, Math.max(0, (performance.now() - store.receivedAt) / 1000));
    const simT = snap.simulationTime + extra;
    env.simTime = simT;
    const clock = worldClock(simT);
    env.hours = clock.hours; env.day = clock.day;
    env.daylight += (clock.daylight - env.daylight) * Math.min(1, dt * 2);
    const kW = 1 - Math.exp(-dt * 0.6);
    env.rain += ((snap.weather === 'rain' ? 1 : 0) - env.rain) * kW;
    env.snow += ((snap.weather === 'snow' ? 1 : 0) - env.snow) * kW;
    env.sunset += ((snap.weather === 'sunset' ? 1 : 0) - env.sunset) * kW;
    const { rain, snow, sunset } = env;
    const day = env.daylight;

    sampleKeys(clock.hours, look);
    sampleKeys(GOLDEN.h, golden);
    // sunset weather = golden hour grading regardless of the clock
    if (sunset > 0.001) {
      look.top.lerp(golden.top, sunset); look.hor.lerp(golden.hor, sunset); look.sun.lerp(golden.sun, sunset);
      look.hs.lerp(golden.hs, sunset); look.hg.lerp(golden.hg, sunset); look.fog.lerp(golden.fog, sunset); look.cloud.lerp(golden.cloud, sunset);
      look.sunI += (golden.sunI - look.sunI) * sunset; look.hI += (golden.hI - look.hI) * sunset;
    }
    const dayish = Math.max(day, sunset);
    if (rain > 0.001) {
      look.top.lerp(tmpA.copy(RAIN.topN).lerp(RAIN.topD, dayish), rain);
      look.hor.lerp(tmpA.copy(RAIN.horN).lerp(RAIN.horD, dayish), rain);
      look.fog.lerp(tmpA.copy(RAIN.horN).lerp(RAIN.horD, dayish), rain);
      look.cloud.lerp(tmpA.copy(RAIN.cloudN).lerp(RAIN.cloudD, dayish), rain);
      look.hs.lerp(tmpA.copy(RAIN.hsN).lerp(RAIN.hsD, dayish), rain * 0.7);
      look.sunI *= 1 - rain * 0.68; look.hI *= 1 + rain * 0.05;
    }
    if (snow > 0.001) {
      look.top.lerp(tmpA.copy(SNOW.topN).lerp(SNOW.topD, dayish), snow);
      look.hor.lerp(tmpA.copy(SNOW.horN).lerp(SNOW.horD, dayish), snow);
      look.fog.lerp(tmpA.copy(SNOW.horN).lerp(SNOW.horD, dayish), snow);
      look.cloud.lerp(tmpA.copy(SNOW.cloudN).lerp(SNOW.cloudD, dayish), snow);
      look.hs.lerp(tmpA.copy(SNOW.hsN).lerp(SNOW.hsD, dayish), snow * 0.7);
      look.sunI *= 1 - snow * 0.45; look.hI *= 1 + snow * 0.12;
    }

    // Key light direction: sun by day, moon by night (always above horizon → stable shadows)
    const el = clock.sunElevation, az = clock.sunAzimuth;
    tmp.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    tmp.moon.set(-0.35, 0.82, 0.45).normalize();
    tmp.gold.set(-0.86, 0.3, 0.2).normalize();
    const sunUp = tmp.sunUp.copy(tmp.sunDir);
    sunUp.y = Math.max(sunUp.y, 0.16); sunUp.normalize();
    const dayW = smooth(0.05, 0.4, day);
    tmp.key.copy(tmp.moon).lerp(sunUp, dayW).lerp(tmp.gold, sunset).normalize();
    if (transparent) tmp.key.set(0.35, 0.88, 0.32).normalize();
    env.keyDir.copy(tmp.key);

    const lights = Math.min(1, Math.max(0, 1 - Math.max(day, sunset * 0.55) * 1.2 + rain * 0.35 + snow * 0.12));
    env.lights += (lights - env.lights) * Math.min(1, dt * 1.5);

    const overlayFloor = transparent ? 0.75 : 0;
    const l = sun.current;
    if (l) {
      l.color.copy(look.sun);
      l.intensity = Math.max(look.sunI, overlayFloor * 2.6);
      l.position.copy(tmp.target).addScaledVector(tmp.key, 70);
    }
    if (hemi.current) {
      hemi.current.color.copy(look.hs);
      hemi.current.groundColor.copy(look.hg);
      hemi.current.intensity = Math.max(look.hI, overlayFloor);
    }
    if (amb.current) amb.current.intensity = 0.12 + (1 - day) * 0.12;

    points.current.forEach((p, i) => {
      if (!p) return;
      const def = NIGHT_LIGHTS[i]!;
      const flicker = i === 2 ? 0.85 + 0.15 * Math.sin(env.t * 6.0) : 1;
      p.intensity = def.intensity * env.lights * flicker;
    });

    if (!transparent) {
      fog.color.copy(look.fog);
      const nightK = 0.82 + 0.18 * day;
      fog.near = Math.max(16, (70 - rain * 48 - snow * 42) * nightK);
      fog.far = Math.max(85, (240 - rain * 140 - snow * 120) * nightK);
      sky.uTop.value.copy(look.top);
      sky.uHorizon.value.copy(look.hor);
      sky.uBottom.value.copy(tmpB.copy(look.fog).multiplyScalar(0.92));
      sky.uSunDir.value.copy(tmp.sunDir).lerp(tmp.gold, sunset).normalize();
      sky.uSunColor.value.copy(look.sun);
      sky.uMoonDir.value.copy(tmp.moon);
      sky.uNight.value = 1 - day;
      sky.uTime.value = env.t;
      sky.uSunVis.value = smooth(-0.12, 0.08, sky.uSunDir.value.y) * (1 - rain * 0.85) * (1 - snow * 0.6);
      sky.uCloudy.value = Math.max(rain, snow * 0.8);
      cloudTint.copy(look.cloud);
    }
    kit.uniforms.uWet.value = rain;
    kit.uniforms.uSnow.value = snow;
  }, -2);

  const mapSize = quality === 'high' ? 2048 : 1024;
  return (
    <>
      <directionalLight ref={sun} castShadow intensity={3} color="#fff4e2" position={[30, 50, 20]}
        shadow-mapSize-width={mapSize} shadow-mapSize-height={mapSize} shadow-bias={-0.0004} shadow-normalBias={0.04} shadow-radius={quality === 'high' ? 3 : 2}
        shadow-camera-left={-36} shadow-camera-right={36} shadow-camera-top={36} shadow-camera-bottom={-36} shadow-camera-near={5} shadow-camera-far={160} />
      <hemisphereLight ref={hemi} args={['#d9ecff', '#8f9c62', 1]} />
      <ambientLight ref={amb} intensity={0.15} color="#ffffff" />
      {NIGHT_LIGHTS.map((d, i) => (
        <pointLight key={i} ref={el => { points.current[i] = el; }} position={d.pos} color={d.color} intensity={0} distance={d.distance} decay={1.6} />
      ))}
    </>
  );
}

function smooth(e0: number, e1: number, x: number) { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }
