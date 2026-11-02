/**
 * Avatar lab (Character Systems): http://localhost:5181/avatar-lab.html
 *   ?view=cast (default) | presets | face | hair | tops | poses | vrm
 */
import { StrictMode, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import type { AvatarAppearance } from '@hello-world/contracts';
import { useAvatarRig, type ExpressionName, type AvatarLod } from '../src/avatars';
import { DEFAULT_APPEARANCE, HAIR_STYLES, TOPS, normalizeAppearance } from '../src/avatars/catalog';
import { AvatarAnimator, type GestureName } from '../src/interactions/animation/AvatarAnimator';
import type { AnimationFamily } from '../src/world/activities';

const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'cast';
const lodParam = (params.get('lod') as AvatarLod) ?? 'high';
const shadows = params.get('shadows') !== '0';

type PartialApp = Omit<Partial<AvatarAppearance>, 'outfit' | 'face' | 'body'> & { outfit?: Partial<AvatarAppearance['outfit']>; face?: Partial<AvatarAppearance['face']>; body?: Partial<AvatarAppearance['body']> };
const A = (p: PartialApp): AvatarAppearance =>
  normalizeAppearance({ ...DEFAULT_APPEARANCE, ...p, outfit: { ...DEFAULT_APPEARANCE.outfit, ...p.outfit }, face: { ...DEFAULT_APPEARANCE.face, ...p.face }, body: { ...DEFAULT_APPEARANCE.body, ...p.body } });

const CAST: AvatarAppearance[] = [
  A({ baseModelId: 'townie-classic', skinTone: '#f6cfa9', hairStyle: 'bob', hairColor: '#3b2417', outfit: { top: 'hoodie', bottom: 'jeans', shoes: 'sneakers', color: '#ff7a59' }, accessories: ['glasses'] }),
  A({ baseModelId: 'townie-sporty', skinTone: '#8f5838', hairStyle: 'buzz', hairColor: '#1c1410', outfit: { top: 'varsity', bottom: 'joggers', shoes: 'hightops', color: '#5b6ee1' }, accessories: ['headphones'], body: { height: 0.7, build: 0.6 } }),
  A({ baseModelId: 'townie-soft', skinTone: '#ffe0c7', hairStyle: 'curly', hairColor: '#c2412d', outfit: { top: 'sweater', bottom: 'skirt', shoes: 'boots', color: '#7bd389' }, accessories: ['scarf'], body: { build: 0.7 } }),
  A({ baseModelId: 'townie-tall', skinTone: '#b97a50', hairStyle: 'afro', hairColor: '#1c1410', outfit: { top: 'jacket', bottom: 'trousers', shoes: 'loafers', color: '#2f2f3a' }, accessories: ['sunglasses'], body: { height: 0.8 } }),
  A({ baseModelId: 'townie-petite', skinTone: '#eab88f', hairStyle: 'ponytail', hairColor: '#d9a441', outfit: { top: 'dress', bottom: 'jeans', shoes: 'sandals', color: '#e36aa6' }, accessories: ['flower', 'earrings'], face: { eyeSize: 0.8 } }),
  A({ baseModelId: 'townie-classic', skinTone: '#6b3f27', hairStyle: 'braids', hairColor: '#1c1410', outfit: { top: 'blouse', bottom: 'leggings', shoes: 'sneakers', color: '#ffd84d' }, accessories: ['backpack'] }),
  A({ baseModelId: 'townie-sporty', skinTone: '#d69c6f', hairStyle: 'spiky', hairColor: '#5b6ee1', outfit: { top: 'tank', bottom: 'shorts', shoes: 'sneakers', color: '#3fb39b' }, accessories: ['cap'], body: { build: 0.4 } }),
  A({ baseModelId: 'townie-soft', skinTone: '#4a2a1a', hairStyle: 'bun', hairColor: '#3b2417', outfit: { top: 'tee', bottom: 'cargo', shoes: 'boots', color: '#9b6ee1' }, accessories: ['bowtie'], body: { build: 0.85 } }),
  A({ baseModelId: 'townie-tall', skinTone: '#f6cfa9', hairStyle: 'mohawk', hairColor: '#e36aa6', outfit: { top: 'jacket', bottom: 'jeans', shoes: 'hightops', color: '#c2412d' }, accessories: ['crown', 'earrings'] }),
  A({ baseModelId: 'townie-petite', skinTone: '#ffe0c7', hairStyle: 'long', hairColor: '#6b4226', outfit: { top: 'tee', bottom: 'skirt', shoes: 'loafers', color: '#4aa3df' }, accessories: ['beanie'], face: { eyeSize: 0.7, mouthSize: 0.6 } }),
];

const PRESETS = ['townie-classic', 'townie-sporty', 'townie-soft', 'townie-tall', 'townie-petite'];
const EXPR: ExpressionName[] = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'relaxed', 'blink', 'aa', 'oh'];

interface Item { a: AvatarAppearance; x: number; z?: number; base?: AnimationFamily; gesture?: GestureName; expr?: ExpressionName; ry?: number; lod?: AvatarLod }

function Avatar({ item, seed }: { item: Item; seed: number }) {
  const rig = useAvatarRig(item.a, item.lod ?? lodParam);
  const anim = useMemo(() => (rig ? new AvatarAnimator(rig, seed) : null), [rig, seed]);
  useEffect(() => {
    if (!anim) return;
    anim.setBase(item.base ?? 'idle');
    if (item.gesture) anim.playGesture(item.gesture, { duration: 60 });
  }, [anim, item.base, item.gesture]);
  useFrame((_, dt) => {
    if (!anim || !rig) return;
    if (item.expr && item.expr !== 'neutral') anim.setExpression(item.expr, 1);
    anim.update(Math.min(dt, 0.05));
  });
  if (!rig) return null;
  return <primitive object={rig.root} position={[item.x, 0, item.z ?? 0]} rotation={[0, item.ry ?? 0, 0]} />;
}

function layout(): { items: Item[]; cam: [number, number, number]; target: [number, number, number]; fov: number } {
  if (view === 'presets') {
    const items = PRESETS.flatMap((p, i) => [0, 0.5, 1].map((b, j) => ({ a: A({ baseModelId: p, body: { build: b, height: 0.5 } }), x: (i - 2) * 1.5 + (j - 1) * 0.45, z: -j * 0.1 })));
    return { items, cam: [0, 1.3, 9.5], target: [0, 0.85, 0], fov: 32 };
  }
  if (view === 'face') {
    const items = EXPR.map((e, i) => ({ a: A({ ...CAST[i % CAST.length]!, baseModelId: 'townie-classic', body: { height: 0.5, build: 0.5 }, accessories: [] }), x: (i - 4) * 0.36, expr: e, base: 'idle' as AnimationFamily }));
    return { items, cam: [0, 1.5, 2.6], target: [0, 1.45, 0], fov: 30 };
  }
  if (view === 'mouth') {
    const ex: ExpressionName[] = ['neutral', 'happy', 'aa', 'oh', 'angry'];
    const items = ex.map((e, i) => ({ a: A({ ...CAST[i]!, baseModelId: 'townie-classic', body: { height: 0.5, build: 0.5 }, accessories: [] }), x: (i - 2) * 0.3, expr: e, base: 'idle' as AnimationFamily }));
    return { items, cam: [0, 1.48, 1.55], target: [0, 1.45, 0], fov: 30 };
  }
  if (view === 'acc') {
    const combos: Array<[string, string[], string]> = [['afro', ['headphones'], '#1c1410'], ['afro', ['flower', 'earrings'], '#3b2417'], ['curly', ['beanie'], '#c2412d'], ['bob', ['headphones'], '#6b4226'], ['bun', ['crown'], '#d9a441'], ['long', ['cap'], '#3b2417'], ['short', ['glasses', 'scarf'], '#a8692e'], ['afro', ['crown'], '#1c1410']];
    const items = combos.map(([h, acc, hc], i) => ({ a: A({ ...CAST[i % CAST.length]!, baseModelId: 'townie-classic', hairStyle: h, hairColor: hc, accessories: acc, body: { height: 0.5, build: 0.5 } }), x: (i - 3.5) * 0.42, ry: i % 2 ? 0.45 : -0.45 }));
    return { items, cam: [0, 1.5, 3.1], target: [0, 1.4, 0], fov: 30 };
  }
  if (view === 'hair') {
    const items = HAIR_STYLES.map((h, i) => ({ a: A({ hairStyle: h.id, hairColor: ['#3b2417', '#d9a441', '#c2412d', '#1c1410', '#6b4226', '#e36aa6'][i % 6]!, outfit: { color: '#4aa3df' } }), x: (i - 5.5) * 0.45, ry: i % 2 ? 0.6 : -0.6 }));
    return { items, cam: [0, 1.45, 4.6], target: [0, 1.35, 0], fov: 32 };
  }
  if (view === 'tops') {
    const items = TOPS.map((t, i) => ({ a: A({ outfit: { top: t.id, bottom: ['jeans', 'shorts', 'skirt', 'trousers', 'joggers', 'leggings', 'cargo', 'jeans'][i]!, shoes: ['sneakers', 'boots', 'sandals', 'loafers', 'hightops', 'sneakers', 'boots', 'hightops'][i]!, color: ['#ff7a59', '#5b6ee1', '#7bd389', '#2f2f3a', '#3fb39b', '#e36aa6', '#ffd84d', '#c2412d'][i]! } }), x: (i - 3.5) * 0.85 }));
    return { items, cam: [0, 1.1, 7.2], target: [0, 0.85, 0], fov: 32 };
  }
  if (view === 'poses') {
    const fam: AnimationFamily[] = ['idle', 'walk', 'run', 'sit', 'dance', 'wave', 'celebrate', 'talk'];
    const items = fam.map((f, i) => ({ a: CAST[i]!, x: (i - 3.5) * 1.0, base: f, ry: 0.5 }));
    return { items, cam: [0, 1.2, 8.5], target: [0, 0.8, 0], fov: 32 };
  }
  if (view === 'vrm') {
    const ids = ['vrm-polybot', 'vrm-astrodisco', 'vrm-coffee', 'vrm-chill'];
    const items: Item[] = ids.map((id, i) => ({ a: A({ ...CAST[i]!, baseModelId: id, accessories: i === 0 ? ['crown'] : [] }), x: (i - 1.5) * 1.2, gesture: i === 1 ? 'wave' : undefined }));
    return { items, cam: [0, 1.2, 6], target: [0, 0.85, 0], fov: 32 };
  }
  if (view === 'lod') {
    const items: Item[] = CAST.slice(0, 5).flatMap((a, i) => [{ a, x: (i - 2) * 1.2 - 0.3, lod: 'high' as AvatarLod }, { a, x: (i - 2) * 1.2 + 0.3, lod: 'low' as AvatarLod }]);
    return { items, cam: [0, 1.2, 8], target: [0, 0.85, 0], fov: 32 };
  }
  const items: Item[] = CAST.map((a, i) => ({ a, x: (i - 4.5) * 0.8, z: (i % 2) * -0.25, gesture: i === 3 ? 'wave' : undefined, expr: (['happy', 'relaxed', 'neutral', 'happy', 'surprised', 'neutral', 'happy', 'relaxed', 'angry', 'happy'] as ExpressionName[])[i] }));
  return { items, cam: [0, 1.2, 7.4], target: [0, 0.86, 0], fov: 33 };
}

function Lab() {
  const L = useMemo(layout, []);
  return (
    <>
      <Canvas shadows={shadows} dpr={shadows ? [1, 1.5] : 1} camera={{ position: L.cam, fov: L.fov, near: 0.05, far: 60 }} onCreated={({ camera }) => camera.lookAt(...L.target)}>
        <color attach="background" args={['#e7eee8']} />
        <fog attach="fog" args={['#e7eee8', 14, 30]} />
        <hemisphereLight args={['#f4f8ff', '#9b8f7a', 0.9]} />
        <directionalLight position={[3.5, 6, 4.5]} intensity={2.3} color="#fff3e2" castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.02}
          shadow-camera-left={-7} shadow-camera-right={7} shadow-camera-top={4} shadow-camera-bottom={-2} />
        <directionalLight position={[-4, 3, -3]} intensity={0.8} color="#cfe0ff" />
        <Environment resolution={128}>
          <Lightformer form="rect" intensity={2.2} position={[0, 4, 3]} scale={[8, 3, 1]} color="#ffffff" />
          <Lightformer form="rect" intensity={1.2} position={[-5, 2, -2]} scale={[4, 3, 1]} color="#bcd4ff" />
          <Lightformer form="ring" intensity={1.0} position={[4, 2, -3]} scale={2} color="#ffd6a8" />
        </Environment>
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <circleGeometry args={[16, 48]} />
          <meshStandardMaterial color="#cdd8c6" roughness={0.95} />
        </mesh>
        {L.items.map((it, i) => <Avatar key={i} item={it} seed={i * 1.7} />)}
      </Canvas>
      <div className="hud">
        {['cast', 'presets', 'face', 'mouth', 'acc', 'hair', 'tops', 'poses', 'vrm', 'lod'].map(v => <a key={v} href={`?view=${v}`}>{v}</a>)}
      </div>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Lab /></StrictMode>);
