/**
 * GPU-driven particle bursts (no per-frame CPU work): sparkles (additive points)
 * and confetti (instanced fluttering quads). Ring-buffer slots, capped counts.
 * Registers emitters on kit.fx so event reactions can trigger them.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useKit } from './context';

const SPARK_VERT = /* glsl */ `
attribute vec3 aOrigin;
attribute vec3 aVel;
attribute vec3 aColor;
attribute vec3 aInfo; // start, life, size
uniform float uTime;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float age = uTime - aInfo.x;
  if (age < 0.0 || age > aInfo.y) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vAlpha = 0.0; vColor = vec3(0.0); return; }
  float k = 1.8;
  vec3 p = aOrigin + aVel * (1.0 - exp(-k * age)) / k + vec3(0.0, -0.7, 0.0) * age * age;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float life = age / aInfo.y;
  vAlpha = (1.0 - life) * (0.6 + 0.4 * sin(age * 24.0 + aInfo.x * 50.0));
  vColor = aColor;
  gl_PointSize = aInfo.z * uScale / -mv.z * (1.0 - life * 0.4);
}`;
const SPARK_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float g = pow(max(0.0, 1.0 - d * 2.0), 1.6);
  float cross = max(0.0, 1.0 - abs(c.x) * 16.0) * max(0.0, 1.0 - abs(c.y) * 2.2) + max(0.0, 1.0 - abs(c.y) * 16.0) * max(0.0, 1.0 - abs(c.x) * 2.2);
  float I = (g + cross * 0.6) * vAlpha * 2.4;
  gl_FragColor = vec4(vColor * max(I, 1.0), min(I, 1.0));
}`;

const CONF_VERT = /* glsl */ `
attribute vec3 aOrigin;
attribute vec3 aVel;
attribute vec3 aColor;
attribute vec4 aSpin;
attribute vec2 aInfo; // start, phase
uniform float uTime;
varying vec3 vColor;
varying float vShade;
vec3 rot(vec3 v, vec3 ax, float a) { return v * cos(a) + cross(ax, v) * sin(a) + ax * dot(ax, v) * (1.0 - cos(a)); }
void main() {
  float age = uTime - aInfo.x;
  if (age < 0.0 || age > 5.6) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vColor = vec3(0.0); vShade = 0.0; return; }
  float k = 2.0;
  vec3 vt = vec3(0.0, -1.05, 0.0);
  vec3 p = aOrigin + (aVel - vt) * (1.0 - exp(-k * age)) / k + vt * age;
  float fl = min(age, 1.0);
  p.x += sin(age * 3.1 + aInfo.y) * 0.32 * fl;
  p.z += cos(age * 2.7 + aInfo.y) * 0.32 * fl;
  bool landed = p.y < 0.06;
  p.y = max(p.y, 0.06);
  vec3 ax = normalize(aSpin.xyz);
  float ang = landed ? aInfo.y : age * aSpin.w + aInfo.y;
  vec3 v = rot(position, ax, ang);
  vec3 n = rot(vec3(0.0, 0.0, 1.0), ax, ang);
  float fade = 1.0 - smoothstep(4.6, 5.6, age);
  vec4 mv = modelViewMatrix * vec4(p + v * fade, 1.0);
  gl_Position = projectionMatrix * mv;
  vShade = 0.62 + 0.38 * abs(n.y) + 0.15 * abs(n.x);
  vColor = aColor;
}`;
const CONF_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vShade;
void main() {
  gl_FragColor = vec4(vColor * vShade, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const CONFETTI_COLORS = ['#ff5f8f', '#ffd166', '#06d6a0', '#4cc9f0', '#c792ea', '#ff8a5b', '#ffffff'];

export function Bursts({ quality }: { quality: 'low' | 'high' }) {
  const kit = useKit();
  const S = quality === 'high' ? 700 : 300;
  const CN = quality === 'high' ? 900 : 360;
  const res = useMemo(() => {
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(S * 3), 3));
    const sOrigin = new THREE.BufferAttribute(new Float32Array(S * 3), 3);
    const sVel = new THREE.BufferAttribute(new Float32Array(S * 3), 3);
    const sColor = new THREE.BufferAttribute(new Float32Array(S * 3), 3);
    const sInfo = new THREE.BufferAttribute(new Float32Array(S * 3).fill(-100), 3);
    for (const a of [sOrigin, sVel, sColor, sInfo]) a.setUsage(THREE.DynamicDrawUsage);
    sg.setAttribute('aOrigin', sOrigin); sg.setAttribute('aVel', sVel); sg.setAttribute('aColor', sColor); sg.setAttribute('aInfo', sInfo);
    const sm = new THREE.ShaderMaterial({ vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG, uniforms: { uTime: kit.uniforms.uTime, uScale: { value: 600 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });

    const base = new THREE.PlaneGeometry(0.17, 0.1);
    const cg = new THREE.InstancedBufferGeometry();
    cg.index = base.index;
    cg.setAttribute('position', base.attributes.position!);
    const ci = (n: number, fill = 0) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(CN * n).fill(fill), n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    const cOrigin = ci(3), cVel = ci(3), cColor = ci(3), cSpin = ci(4, 1), cInfo = ci(2, -100);
    cg.setAttribute('aOrigin', cOrigin); cg.setAttribute('aVel', cVel); cg.setAttribute('aColor', cColor); cg.setAttribute('aSpin', cSpin); cg.setAttribute('aInfo', cInfo);
    cg.instanceCount = CN;
    const cm = new THREE.ShaderMaterial({ vertexShader: CONF_VERT, fragmentShader: CONF_FRAG, uniforms: { uTime: kit.uniforms.uTime }, side: THREE.DoubleSide });
    return { sg, sm, sOrigin, sVel, sColor, sInfo, base, cg, cm, cOrigin, cVel, cColor, cSpin, cInfo, sHead: 0, cHead: 0, sLive: -1, cLive: -1 };
  }, [kit, S, CN]);
  useEffect(() => () => { res.sg.dispose(); res.sm.dispose(); res.base.dispose(); res.cg.dispose(); res.cm.dispose(); }, [res]);

  useEffect(() => {
    const col = new THREE.Color();
    kit.fx.emitSparkles = (o, count, palette, spread = 1) => {
      const n = Math.min(count, S);
      const t = kit.env.t;
      for (let i = 0; i < n; i++) {
        const j = res.sHead; res.sHead = (res.sHead + 1) % S;
        const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
        const sp = (1.2 + Math.random() * 2.6) * spread;
        res.sOrigin.setXYZ(j, o.x + (Math.random() - 0.5) * 0.6, o.y + (Math.random() - 0.5) * 0.6, o.z + (Math.random() - 0.5) * 0.6);
        res.sVel.setXYZ(j, Math.sin(ph) * Math.cos(th) * sp, Math.abs(Math.cos(ph)) * sp * 0.9 + 0.6, Math.sin(ph) * Math.sin(th) * sp);
        col.set(palette[i % palette.length] ?? '#ffffff');
        res.sColor.setXYZ(j, col.r, col.g, col.b);
        res.sInfo.setXYZ(j, t + Math.random() * 0.25, 1.1 + Math.random() * 1.2, 0.12 + Math.random() * 0.14);
      }
      for (const a of [res.sOrigin, res.sVel, res.sColor, res.sInfo]) a.needsUpdate = true;
      res.sLive = Math.max(res.sLive, t + 2.7);
    };
    kit.fx.emitConfetti = (o, count) => {
      const n = Math.min(count, CN);
      const t = kit.env.t;
      for (let i = 0; i < n; i++) {
        const j = res.cHead; res.cHead = (res.cHead + 1) % CN;
        const th = Math.random() * Math.PI * 2;
        const sp = 1.5 + Math.random() * 3.5;
        res.cOrigin.setXYZ(j, o.x + (Math.random() - 0.5) * 1.2, o.y + Math.random() * 0.8, o.z + (Math.random() - 0.5) * 1.2);
        res.cVel.setXYZ(j, Math.cos(th) * sp, 2.5 + Math.random() * 4.5, Math.sin(th) * sp);
        col.set(CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]!);
        res.cColor.setXYZ(j, col.r, col.g, col.b);
        res.cSpin.setXYZ(j, Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
        res.cSpin.setW(j, 4 + Math.random() * 8);
        res.cInfo.setXY(j, t + Math.random() * 0.15, Math.random() * 6.28);
      }
      for (const a of [res.cOrigin, res.cVel, res.cColor, res.cSpin, res.cInfo]) a.needsUpdate = true;
      res.cLive = Math.max(res.cLive, t + 6);
    };
    return () => { kit.fx.emitSparkles = () => {}; kit.fx.emitConfetti = () => {}; };
  }, [kit, res, S, CN]);

  const sparkRef = useRef<THREE.Points>(null);
  const confRef = useRef<THREE.Mesh>(null);
  useFrame(state => {
    // idle particle systems cost nothing (no draw calls)
    if (sparkRef.current) sparkRef.current.visible = kit.env.t < res.sLive;
    if (confRef.current) confRef.current.visible = kit.env.t < res.cLive;
    const cam = state.camera as THREE.PerspectiveCamera;
    res.sm.uniforms.uScale!.value = (state.size.height * state.viewport.dpr) / (2 * Math.tan(THREE.MathUtils.degToRad((cam.fov ?? 45) / 2)));
  });

  return (
    <group>
      <points ref={sparkRef} geometry={res.sg} material={res.sm} frustumCulled={false} renderOrder={10} visible={false} />
      <mesh ref={confRef} geometry={res.cg} material={res.cm} frustumCulled={false} visible={false} />
    </group>
  );
}
