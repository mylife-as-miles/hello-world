/**
 * Pooled, allocation-free visual effects for the residents layer:
 *  - EmoteSystem: billboard sprites (hearts, notes, sparkles, anger puff,
 *    grumpy cloud, Zzz, '!') drawn once into cached canvas textures.
 *  - GiftSystem: wrapped gift boxes that arc from giver to receiver.
 *  - Nameplate textures (canvas) for residents.
 * Everything here is disposed by its owner.
 */
import * as THREE from 'three';

export type EmoteKind = 'heart' | 'note' | 'sparkle' | 'anger' | 'cloud' | 'zzz' | 'bang';
const EMOTE_KINDS: EmoteKind[] = ['heart', 'note', 'sparkle', 'anger', 'cloud', 'zzz', 'bang'];

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}

function drawEmote(kind: EmoteKind): HTMLCanvasElement {
  const [c, g] = canvas(128, 128);
  g.lineJoin = 'round'; g.lineCap = 'round';
  switch (kind) {
    case 'heart': {
      g.beginPath();
      g.moveTo(64, 112);
      g.bezierCurveTo(10, 74, 8, 38, 34, 26);
      g.bezierCurveTo(50, 19, 60, 28, 64, 40);
      g.bezierCurveTo(68, 28, 78, 19, 94, 26);
      g.bezierCurveTo(120, 38, 118, 74, 64, 112);
      g.closePath();
      const gr = g.createLinearGradient(0, 20, 0, 112);
      gr.addColorStop(0, '#ff8fb1'); gr.addColorStop(1, '#ff3d6e');
      g.fillStyle = gr; g.fill();
      g.lineWidth = 6; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.beginPath(); g.ellipse(42, 44, 9, 6, -0.6, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'note': {
      g.fillStyle = '#ffffff'; g.strokeStyle = '#6d4cff'; g.lineWidth = 7;
      const head = (x: number, y: number) => { g.beginPath(); g.ellipse(x, y, 15, 11, -0.4, 0, Math.PI * 2); g.fill(); g.stroke(); };
      g.beginPath(); g.moveTo(52, 92); g.lineTo(52, 30); g.lineTo(100, 20); g.lineTo(100, 80); g.stroke();
      g.beginPath(); g.moveTo(52, 30); g.lineTo(100, 20); g.lineTo(100, 34); g.lineTo(52, 44); g.closePath(); g.fillStyle = '#6d4cff'; g.fill();
      g.fillStyle = '#ffffff';
      head(40, 94); head(88, 84);
      break;
    }
    case 'sparkle': {
      const star = (x: number, y: number, r: number) => {
        g.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
          const rr = i % 2 === 0 ? r : r * 0.28;
          g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        g.closePath();
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.45, '#fff3a8'); gr.addColorStop(1, '#ffc93c');
        g.fillStyle = gr; g.fill();
      };
      star(58, 62, 50); star(104, 24, 18);
      break;
    }
    case 'anger': {
      g.strokeStyle = '#ff3b3b'; g.lineWidth = 14;
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 + Math.PI / 4;
        const cx = 64 + Math.cos(a) * 30, cy = 64 + Math.sin(a) * 30;
        g.beginPath(); g.arc(cx, cy, 20, a + Math.PI * 0.6, a + Math.PI * 1.4); g.stroke();
      }
      break;
    }
    case 'cloud': {
      g.fillStyle = '#5d6470';
      for (const [x, y, r] of [[40, 72, 26], [64, 56, 30], [90, 70, 26], [66, 82, 26]] as const) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
      g.strokeStyle = '#1f232a'; g.lineWidth = 6;
      g.beginPath(); g.moveTo(40, 72);
      for (let i = 0; i < 6; i++) g.lineTo(46 + i * 8, i % 2 ? 62 : 80);
      g.stroke();
      g.strokeStyle = '#ffd84d'; g.lineWidth = 5;
      g.beginPath(); g.moveTo(70, 104); g.lineTo(62, 118); g.lineTo(72, 116); g.lineTo(64, 128); g.stroke();
      break;
    }
    case 'zzz': {
      g.font = '900 64px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 10; g.strokeStyle = '#3b4cca'; g.fillStyle = '#e8ecff';
      g.strokeText('Z', 54, 70); g.fillText('Z', 54, 70);
      g.font = '900 38px system-ui, sans-serif';
      g.strokeText('z', 96, 34); g.fillText('z', 96, 34);
      break;
    }
    case 'bang': {
      g.fillStyle = '#ffd84d'; g.strokeStyle = '#ffffff'; g.lineWidth = 6;
      g.beginPath(); g.roundRect(30, 14, 68, 100, 22); g.fill(); g.stroke();
      g.fillStyle = '#3a2a1e';
      g.beginPath(); g.roundRect(56, 28, 16, 50, 8); g.fill();
      g.beginPath(); g.arc(64, 94, 9, 0, Math.PI * 2); g.fill();
      break;
    }
  }
  return c;
}

interface Particle { life: number; max: number; vx: number; vy: number; vz: number; size: number; wob: number; active: boolean }

export class EmoteSystem {
  readonly group = new THREE.Group();
  private readonly sprites: THREE.Sprite[] = [];
  private readonly parts: Particle[] = [];
  private readonly textures = new Map<EmoteKind, THREE.CanvasTexture>();
  private cursor = 0;

  constructor(capacity = 72) {
    this.group.name = 'resident-emotes';
    for (const k of EMOTE_KINDS) {
      const tex = new THREE.CanvasTexture(drawEmote(k));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 2;
      this.textures.set(k, tex);
    }
    for (let i = 0; i < capacity; i++) {
      const m = new THREE.SpriteMaterial({ transparent: true, depthWrite: false, opacity: 0 });
      const s = new THREE.Sprite(m);
      s.visible = false; s.renderOrder = 20; s.frustumCulled = false;
      s.raycast = () => {};
      this.group.add(s);
      this.sprites.push(s);
      this.parts.push({ life: 0, max: 1, vx: 0, vy: 0, vz: 0, size: 0.3, wob: 0, active: false });
    }
  }

  spawn(kind: EmoteKind, x: number, y: number, z: number, count = 1, spread = 0.35): void {
    const tex = this.textures.get(kind);
    if (!tex) return;
    for (let n = 0; n < count; n++) {
      const i = this.cursor; this.cursor = (this.cursor + 1) % this.sprites.length;
      const s = this.sprites[i]!, p = this.parts[i]!;
      const m = s.material as THREE.SpriteMaterial;
      if (m.map !== tex) { m.map = tex; m.needsUpdate = true; }
      const a = Math.random() * Math.PI * 2, r = spread * Math.sqrt(Math.random());
      s.position.set(x + Math.cos(a) * r * 0.6, y + Math.random() * 0.15, z + Math.sin(a) * r * 0.6);
      p.active = true; p.life = -n * 0.12;
      p.max = kind === 'zzz' ? 2.6 : kind === 'cloud' || kind === 'anger' ? 1.9 : 1.6 + Math.random() * 0.5;
      p.vx = Math.cos(a) * r * 0.5; p.vz = Math.sin(a) * r * 0.5;
      p.vy = kind === 'zzz' ? 0.32 : kind === 'cloud' ? 0.12 : 0.55 + Math.random() * 0.3;
      if (kind === 'zzz') p.vx += 0.12;
      p.size = kind === 'sparkle' ? 0.22 + Math.random() * 0.14 : kind === 'cloud' ? 0.5 : kind === 'bang' ? 0.34 : 0.27 + Math.random() * 0.08;
      p.wob = Math.random() * 6;
      s.visible = false; m.opacity = 0;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i]!;
      if (!p.active) continue;
      const s = this.sprites[i]!;
      p.life += dt;
      if (p.life < 0) continue;
      if (p.life >= p.max) { p.active = false; s.visible = false; continue; }
      s.visible = true;
      const u = p.life / p.max;
      s.position.x += (p.vx + Math.sin(p.life * 4 + p.wob) * 0.12) * dt;
      s.position.y += p.vy * dt;
      s.position.z += p.vz * dt;
      p.vy *= 1 - dt * 0.6;
      const pop = u < 0.15 ? 0.4 + 0.6 * (u / 0.15) * 1.15 : 1 + 0.05 * Math.sin(p.life * 9 + p.wob);
      const sc = p.size * pop;
      s.scale.set(sc, sc, sc);
      (s.material as THREE.SpriteMaterial).opacity = u < 0.1 ? u / 0.1 : u > 0.7 ? (1 - u) / 0.3 : 1;
    }
  }

  dispose(): void {
    for (const s of this.sprites) (s.material as THREE.Material).dispose();
    for (const t of this.textures.values()) t.dispose();
    this.group.clear();
  }
}

interface GiftFlight { obj: THREE.Group; t: number; dur: number; from: THREE.Vector3; to: THREE.Vector3; active: boolean; onLand: (() => void) | null }

export class GiftSystem {
  readonly group = new THREE.Group();
  private readonly flights: GiftFlight[] = [];
  private readonly geo = new THREE.BoxGeometry(1, 1, 1);
  private readonly mats: THREE.MeshStandardMaterial[];
  private readonly ribbon = new THREE.MeshStandardMaterial({ color: '#ffd84d', roughness: 0.35, metalness: 0.2, emissive: '#5a4300', emissiveIntensity: 0.25 });

  constructor(capacity = 6) {
    this.group.name = 'resident-gifts';
    this.mats = ['#ff5d8f', '#5b8cff', '#3fb39b', '#9b6ee1'].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55 }));
    for (let i = 0; i < capacity; i++) {
      const g = new THREE.Group();
      const box = new THREE.Mesh(this.geo, this.mats[i % this.mats.length]!);
      box.scale.set(0.26, 0.22, 0.26); box.castShadow = true;
      const r1 = new THREE.Mesh(this.geo, this.ribbon); r1.scale.set(0.27, 0.23, 0.06);
      const r2 = new THREE.Mesh(this.geo, this.ribbon); r2.scale.set(0.06, 0.23, 0.27);
      const bow1 = new THREE.Mesh(this.geo, this.ribbon); bow1.scale.set(0.1, 0.05, 0.05); bow1.position.set(-0.05, 0.14, 0); bow1.rotation.z = 0.5;
      const bow2 = new THREE.Mesh(this.geo, this.ribbon); bow2.scale.set(0.1, 0.05, 0.05); bow2.position.set(0.05, 0.14, 0); bow2.rotation.z = -0.5;
      g.add(box, r1, r2, bow1, bow2);
      g.visible = false;
      g.traverse(o => { o.raycast = () => {}; });
      this.group.add(g);
      this.flights.push({ obj: g, t: 0, dur: 1.2, from: new THREE.Vector3(), to: new THREE.Vector3(), active: false, onLand: null });
    }
  }

  launch(from: THREE.Vector3, to: THREE.Vector3, onLand: () => void, delay = 0.35): void {
    const f = this.flights.find(x => !x.active) ?? this.flights[0]!;
    if (f.active) f.onLand?.();
    f.from.copy(from); f.to.copy(to);
    f.dur = 0.9 + Math.min(1.2, from.distanceTo(to) * 0.12);
    f.t = -delay; f.active = true; f.onLand = onLand;
    f.obj.visible = false;
  }

  update(dt: number): void {
    for (const f of this.flights) {
      if (!f.active) continue;
      f.t += dt;
      if (f.t < 0) continue;
      const u = Math.min(1, f.t / f.dur);
      const o = f.obj;
      o.visible = true;
      o.position.lerpVectors(f.from, f.to, u);
      o.position.y += Math.sin(u * Math.PI) * (0.9 + f.from.distanceTo(f.to) * 0.08);
      o.rotation.set(Math.sin(u * 6) * 0.3, u * Math.PI * 3, 0);
      const sc = u < 0.12 ? u / 0.12 : u > 0.9 ? 1 - (u - 0.9) / 0.1 * 0.6 : 1;
      o.scale.setScalar(sc);
      if (u >= 1) { f.active = false; o.visible = false; const cb = f.onLand; f.onLand = null; cb?.(); }
    }
  }

  dispose(): void {
    this.geo.dispose(); this.ribbon.dispose();
    for (const m of this.mats) m.dispose();
    this.group.clear();
  }
}

/** Small rounded name label texture. */
export function makeNameplateTexture(name: string, accent?: string): { texture: THREE.CanvasTexture; aspect: number } {
  const label = name.length > 22 ? `${name.slice(0, 21)}…` : name;
  const scale = 2;
  const [, measure] = canvas(4, 4);
  measure.font = `600 ${22 * scale}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
  const tw = Math.ceil(measure.measureText(label).width);
  const w = tw + 34 * scale + (accent ? 14 * scale : 0), h = 38 * scale;
  const [c, g] = canvas(w, h);
  g.fillStyle = 'rgba(14, 20, 24, 0.62)';
  g.beginPath(); g.roundRect(2, 2, w - 4, h - 4, h / 2 - 2); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 2; g.stroke();
  let x = 17 * scale;
  if (accent) {
    g.fillStyle = accent;
    g.beginPath(); g.arc(x + 4 * scale, h / 2, 5 * scale, 0, Math.PI * 2); g.fill();
    x += 14 * scale;
  }
  g.font = `600 ${22 * scale}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
  g.textBaseline = 'middle';
  g.fillStyle = '#f4f7f5';
  g.fillText(label, x, h / 2 + 1);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;
  return { texture, aspect: w / h };
}
