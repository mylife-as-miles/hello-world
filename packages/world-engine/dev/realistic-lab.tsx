/**
 * Realistic avatar lab (port 5187): every realistic base side by side, driven by AvatarAnimator.
 * Front row faces the camera; back row is the same bases turned 90° (profile view).
 * ?pose=<family|wave> pins every avatar to one animation; default cycles idle → walk → wave → sit → dance.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { AvatarAppearance } from '@hello-world/contracts';
import { loadRealisticRig, REALISTIC_BASE_MODELS } from '../src/avatars/realistic/index';
import type { HumanoidRig } from '../src/avatars/rig';
import { AvatarAnimator } from '../src/interactions/animation/AvatarAnimator';
import type { AnimationFamily } from '../src/world/activities';

const params = new URLSearchParams(location.search);
const pinned = params.get('pose');
const CYCLE = ['idle', 'walk', 'wave', 'sit', 'dance'] as const;
const hud = document.getElementById('hud')!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(1.5, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.getElementById('root')!.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x26313a);
const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 2.0, +(params.get('z') ?? 10.5));
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.95, -1.2);
controls.update();
scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x4a3d33, 1.2));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
sun.position.set(3, 6, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6 });
scene.add(sun);
const fill = new THREE.DirectionalLight(0xbfd6ff, 0.8);
fill.position.set(-4, 3, -2);
scene.add(fill);
const ground = new THREE.Mesh(new THREE.CircleGeometry(14, 48), new THREE.MeshStandardMaterial({ color: 0x5d6b5a, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

interface Entry { rig: HumanoidRig; anim: AvatarAnimator; seat: THREE.Mesh; label: string }
const entries: Entry[] = [];
const seatGeo = new THREE.BoxGeometry(0.5, 0.45, 0.45);
const seatMat = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.8 });

function appearanceFor(id: string, i: number): AvatarAppearance {
  return {
    baseModelId: id, skinTone: '#c89a7c', hairStyle: 'short', hairColor: '#2a1d14',
    outfit: { top: 'tee', bottom: 'jeans', shoes: 'sneakers', color: params.has('tint') ? ['#d9534f', '#3a7bd5', '#4caf50', '#e0a030'][i % 4]! : '' },
    accessories: [], face: { eyeColor: '#3b2a1a', eyeSize: 0.5, noseSize: 0.5, mouthSize: 0.5 }, body: { height: 0.6, build: 0.5 },
  };
}

async function main() {
  const ids = REALISTIC_BASE_MODELS.map((b) => b.id);
  const n = ids.length;
  const t0 = performance.now();
  for (let row = 0; row < 2; row++) {
    await Promise.all(ids.map(async (id, i) => {
      const rig = await loadRealisticRig(appearanceFor(id, i), { lod: row === 0 ? 'high' : 'low' });
      if (!rig) { console.error('realistic rig failed', id); return; }
      const x = (i - (n - 1) / 2) * 1.6;
      const z = row === 0 ? 0 : -3;
      rig.root.position.set(x, 0, z);
      rig.root.rotation.y = row === 0 ? 0 : Math.PI / 2; // back row: profile (faces +X)
      rig.root.traverse((o) => { o.castShadow = true; });
      scene.add(rig.root);
      const seat = new THREE.Mesh(seatGeo, seatMat);
      seat.position.set(0, 0.225, -0.12);
      seat.visible = false;
      seat.castShadow = true;
      rig.root.add(seat);
      entries.push({ rig, anim: new AvatarAnimator(rig, i * 7919 + row), seat, label: id });
    }));
  }
  hud.textContent = `${entries.length} rigs loaded in ${((performance.now() - t0) / 1000).toFixed(1)}s · stats ${JSON.stringify((globalThis as { __HW_AVATAR_STATS?: unknown }).__HW_AVATAR_STATS)}`;
  (window as unknown as { __lab: unknown }).__lab = { entries };
}

let phase = -1;
let applied = 0;
let clock = 0;
function setPhase(p: number) {
  phase = p;
  const name = pinned ?? CYCLE[p % CYCLE.length]!;
  for (const e of entries) {
    if (name === 'wave') { e.anim.setBase('idle'); e.anim.playGesture('wave', { duration: 4 }); }
    else e.anim.setBase(name as AnimationFamily, name === 'walk' ? { speed: 1 } : {});
    e.seat.visible = name === 'sit';
  }
  hud.dataset.pose = name;
}

let last = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  clock += dt;
  if (entries.length) {
    const p = Math.floor(clock / 4);
    if (p !== phase || phase < 0 || applied !== entries.length) { applied = entries.length; setPhase(p); }
    for (const e of entries) { e.anim.update(dt); e.rig.update(dt); }
  }
  renderer.render(scene, camera);
});
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
void main();
