/**
 * AvatarCreator — HELLO WORLD character studio (inZOI-inspired).
 *
 * Contract props (`AvatarCreatorProps`) + optional extras. Every control edits
 * the real `AvatarAppearance` and the live 3D preview rebuilds from it via the
 * shared avatar API (`loadAvatarRig`), so procedural/VRM upgrades flow in
 * automatically. Saving always calls `onSave(normalizeAppearance(state))`.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { AvatarAppearance, AvatarCreatorProps } from '@hello-world/contracts';
import {
  ACCESSORIES, BASE_MODELS, BOTTOMS, DEFAULT_APPEARANCE, EYE_COLORS, HAIR_COLORS, HAIR_STYLES, OUTFIT_COLORS,
  PERSONALITY_TRAITS, SHOES, SKIN_TONES, TOPS, normalizeAppearance,
} from '../avatars/catalog';
import * as AvatarApi from '../avatars';
import { isVrmBase, type HumanoidRig } from '../avatars';
import { REALISTIC_BASE_MODELS, REALISTIC_SUPPORT, isRealisticBase, type AppearanceSupport } from '../avatars/realistic';
import type { BaseModelEntry } from '../avatars/catalog';
import type { GestureName } from '../interactions/animation/AvatarAnimator';
import { CreatorPreview, type CameraPreset, type PreviewBase, type PreviewCommand, type PreviewExpression } from './CreatorPreview';
import { CHARACTER_PRESETS, MAX_ACCESSORIES, MAX_TRAITS, randomAppearance, sanitizeTraits, toggleCapped } from './presets';
import { Bust, BodyGlyph, Icon } from './art';
import { CREATOR_CSS } from './styles';

export interface SavedCharacter { appearance: AvatarAppearance; personality: string[]; displayName: string }

export interface AvatarCreatorExtraProps {
  /** Prefill personality trait ids (max 3, unknown ids dropped). */
  initialPersonality?: string[];
  /** Called on save (in addition to `onSave`) with appearance + personality + name. */
  onSaveCharacter?: (c: SavedCharacter) => void;
  className?: string;
}

const ACCENT = '#a28fff';
const SECTIONS = [
  { id: 'presets', label: 'Presets', icon: 'presets' },
  { id: 'body', label: 'Body', icon: 'body' },
  { id: 'face', label: 'Face', icon: 'face' },
  { id: 'hair', label: 'Hair', icon: 'hair' },
  { id: 'outfit', label: 'Outfit', icon: 'outfit' },
  { id: 'extras', label: 'Extras', icon: 'extras' },
  { id: 'personality', label: 'Traits', icon: 'personality' },
] as const;
type SectionId = typeof SECTIONS[number]['id'];

const EXPRESSION_BUTTONS: Array<{ name: PreviewExpression; label: string; emo: string }> = [
  { name: 'happy', label: 'Happy', emo: '\u{1F60A}' },
  { name: 'sad', label: 'Sad', emo: '\u{1F622}' },
  { name: 'angry', label: 'Angry', emo: '\u{1F620}' },
  { name: 'surprised', label: 'Surprised', emo: '\u{1F62E}' },
  { name: 'relaxed', label: 'Relaxed', emo: '\u{1F60C}' },
  { name: 'blink', label: 'Blink', emo: '\u{1F609}' },
];
const ANIMATION_BUTTONS: Array<{ name: 'idle' | 'wave' | 'dance' | 'walk'; label: string }> = [
  { name: 'idle', label: 'Idle' }, { name: 'wave', label: 'Wave' }, { name: 'dance', label: 'Dance' }, { name: 'walk', label: 'Walk' },
];
const CAMERA_BUTTONS: Array<{ id: CameraPreset; label: string; short: string }> = [
  { id: 'full', label: 'Full body', short: 'Full' }, { id: 'upper', label: 'Upper body', short: 'Upper' }, { id: 'face', label: 'Face', short: 'Face' },
];

const cls = (...xs: Array<string | false | null | undefined>) => xs.filter(Boolean).join(' ');
const keyOf = (a: AvatarAppearance) => JSON.stringify(a);

const FULL_SUPPORT: AppearanceSupport = { skinTone: true, hair: true, outfitColor: true, outfitPieces: true, face: true, body: true, accessories: true };
const VRM_SUPPORT: AppearanceSupport = { skinTone: false, hair: false, outfitColor: false, outfitPieces: false, face: false, body: true, accessories: true };

/**
 * Which appearance fields visibly apply to a base. Prefers the avatar API's
 * `getAppearanceSupport` when present (looked up dynamically so this works
 * before/after it lands), else realistic/VRM/procedural defaults.
 */
export function appearanceSupportFor(baseModelId: string): AppearanceSupport {
  const fn = (AvatarApi as unknown as Record<string, unknown>)['getAppearanceSupport'];
  if (typeof fn === 'function') {
    try {
      const r = (fn as (id: string) => Partial<AppearanceSupport> | null | undefined)(baseModelId);
      if (r && typeof r === 'object') return { ...FULL_SUPPORT, ...r };
    } catch { /* fall back below */ }
  }
  if (isRealisticBase(baseModelId)) return REALISTIC_SUPPORT;
  if (isVrmBase(baseModelId)) return VRM_SUPPORT;
  return FULL_SUPPORT;
}

/** Realistic bodies read straight from the realistic catalog (works before the BASE_MODELS merge), de-duplicated. */
function realisticBases(): BaseModelEntry[] {
  const seen = new Set<string>();
  const out: BaseModelEntry[] = [];
  for (const m of [...REALISTIC_BASE_MODELS, ...BASE_MODELS.filter(b => isRealisticBase(b.id))]) {
    if (!seen.has(m.id)) { seen.add(m.id); out.push(m); }
  }
  return out;
}
const realisticTag = (id: string) => (id.startsWith('rb-') ? 'Photoreal · Rocketbox (MIT)' : 'Photoreal · MetaHuman licence');

function BaseCard({ m, on, onPick, tag }: { m: BaseModelEntry; on: boolean; onPick: () => void; tag?: string }) {
  return (
    <button type="button" className={cls('hwc-base', on && 'is-on', tag && 'hwc-base-real')} aria-pressed={on}
      aria-label={`Base body ${m.label}${tag ? ` (${tag})` : m.kind === 'vrm' ? ' (VRM model)' : ''}`} data-testid={`base-${m.id}`} onClick={onPick}>
      <BodyGlyph id={m.id} color={on ? '#cfc4ff' : 'rgba(236,232,250,.55)'} />
      <span>
        <b>{m.label}{m.kind === 'vrm' && !tag && <span className="hwc-kind">VRM</span>}</b>
        <small>{m.description}</small>
        {tag && <small className="hwc-realtag">{tag}</small>}
        {m.credit && <small className="hwc-credit">{m.credit}</small>}
      </span>
    </button>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <div className="hwc-note" role="note">{children}</div>;
}

// ---------------------------------------------------------------- controls
function Section({ id, domId, title, sub, action, children, onEngage }: {
  id: SectionId; domId: string; title: string; sub?: ReactNode; action?: ReactNode; children: ReactNode; onEngage?: () => void;
}) {
  return (
    <section className="hwc-sec" id={domId} data-section={id} aria-labelledby={`${domId}-t`} onFocusCapture={onEngage} onPointerDownCapture={onEngage}>
      <div className="hwc-sec-head">
        <div><h3 className="hwc-sec-title" id={`${domId}-t`}>{title}</h3>{sub && <div className="hwc-sec-sub">{sub}</div>}</div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Swatches({ label, colors, value, onChange, testIdPrefix }: {
  label: string; colors: readonly string[]; value: string; onChange: (hex: string) => void; testIdPrefix?: string;
}) {
  const v = value.toLowerCase();
  const custom = !colors.some(c => c.toLowerCase() === v);
  return (
    <div className="hwc-swatches" role="group" aria-label={label}>
      {colors.map((c, i) => (
        <button key={c} type="button" className={cls('hwc-swatch', c.toLowerCase() === v && 'is-on')} style={{ '--sw': c } as CSSProperties}
          aria-pressed={c.toLowerCase() === v} aria-label={`${label} ${i + 1}`} title={c}
          data-testid={testIdPrefix ? `${testIdPrefix}-${i}` : undefined} onClick={() => onChange(c.toLowerCase())} />
      ))}
      <label className={cls('hwc-swatch', 'hwc-swatch-custom', custom && 'is-on')} style={custom ? { '--sw': value } as CSSProperties : undefined} title="Custom colour">
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#888888'} aria-label={`Custom ${label.toLowerCase()}`}
          onChange={e => onChange(e.target.value.toLowerCase())} data-testid={testIdPrefix ? `${testIdPrefix}-custom` : undefined} />
      </label>
    </div>
  );
}

function Slider({ label, value, onChange, ends, testId }: { label: string; value: number; onChange: (v: number) => void; ends: [string, string]; testId?: string }) {
  return (
    <label className="hwc-slider">
      <span className="hwc-slider-head"><span>{label}</span><output>{Math.round(value * 100)}</output></span>
      <input type="range" min={0} max={1} step={0.01} value={value} aria-label={label} data-testid={testId}
        aria-valuetext={`${Math.round(value * 100)} percent`} style={{ '--p': `${value * 100}%` } as CSSProperties}
        onChange={e => onChange(Number(e.target.value))} />
      <span className="hwc-slider-ends" aria-hidden="true"><span>{ends[0]}</span><span>{ends[1]}</span></span>
    </label>
  );
}

// ---------------------------------------------------------------- creator
export function AvatarCreator(props: AvatarCreatorProps & AvatarCreatorExtraProps) {
  const { onSave, onCancel, onSaveCharacter, className } = props;
  const displayName = props.displayName?.trim() || 'You';
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  // Captured once: editing an existing character prefills from these, Reset returns to them.
  const [initial] = useState(() => ({
    appearance: normalizeAppearance(props.initialAppearance ?? DEFAULT_APPEARANCE),
    personality: sanitizeTraits(props.initialPersonality),
  }));
  const [appearance, setAppearance] = useState<AvatarAppearance>(initial.appearance);
  const [personality, setPersonality] = useState<string[]>(initial.personality);
  const [activePreset, setActivePreset] = useState<number | null>(() =>
    { const i = CHARACTER_PRESETS.findIndex(p => keyOf(p.appearance) === keyOf(initial.appearance)); return i >= 0 ? i : null; });
  const [randomClicks, setRandomClicks] = useState(0);
  const traitsFromPreset = useRef(initial.personality.length === 0);

  // preview state
  const [camera, setCamera] = useState<CameraPreset>('full');
  const [cameraNonce, setCameraNonce] = useState(0);
  const [autoRotate, setAutoRotate] = useState(false);
  const [base, setBase] = useState<PreviewBase>('idle');
  const [gesture, setGesture] = useState<PreviewCommand<GestureName> | null>(null);
  const [expression, setExpression] = useState<PreviewCommand<PreviewExpression> | null>(null);
  const [flash, setFlash] = useState<{ expr: PreviewExpression | null; wave: boolean }>({ expr: null, wave: false });
  const nonce = useRef(0);
  const loadingEl = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const insets = useRef({ top: 70, bottom: 120 });
  // Measure the overlay bands so the camera frames the character in the free space.
  useEffect(() => {
    const stage = stageRef.current, top = topRef.current, dock = dockRef.current;
    if (!stage || !top || !dock || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const s = stage.getBoundingClientRect(), t = top.getBoundingClientRect(), d = dock.getBoundingClientRect();
      const panel = stage.parentElement?.querySelector<HTMLElement>('.hwc-panel')?.getBoundingClientRect();
      const coveredBottom = panel && panel.top < s.bottom && panel.left < s.right - 1 ? s.bottom - panel.top : 0;
      insets.current = { top: Math.max(0, t.bottom - s.top + 10), bottom: Math.max(coveredBottom, s.bottom - d.top + 12) };
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage); ro.observe(top); ro.observe(dock);
    return () => ro.disconnect();
  }, []);
  // Rig swaps are reported straight to the DOM (no React re-render): useful for
  // tests/QA to confirm the rig only rebuilds when the appearance changes.
  const rigBuilds = useRef(0);
  const onRigReady = useCallback((rig: HumanoidRig) => {
    rigBuilds.current += 1;
    const el = stageRef.current;
    if (el) { el.dataset.rigBuilds = String(rigBuilds.current); el.dataset.rigKind = rig.kind; }
  }, []);
  const flashTimers = useRef<{ expr?: number; wave?: number }>({});
  useEffect(() => () => { window.clearTimeout(flashTimers.current.expr); window.clearTimeout(flashTimers.current.wave); }, []);

  const appearanceKey = useMemo(() => keyOf(appearance), [appearance]);
  const dirty = appearanceKey !== keyOf(initial.appearance) || personality.join(',') !== initial.personality.join(',');
  const vrm = isVrmBase(appearance.baseModelId);
  const realistic = isRealisticBase(appearance.baseModelId);
  const realBases = realisticBases();
  const baseEntry = BASE_MODELS.find(m => m.id === appearance.baseModelId) ?? realBases.find(m => m.id === appearance.baseModelId);
  const support = appearanceSupportFor(appearance.baseModelId);
  const baseName = baseEntry?.label.replace(/\s*\([^)]*\)\s*$/, '') || 'This body';
  const fixedWhy = realistic ? 'a photoreal body with its own authored look' : vrm ? 'a VRM avatar with its own authored look' : 'a fixed-look body';

  // ---- edits
  const edit = useCallback((fn: (a: AvatarAppearance) => AvatarAppearance) => {
    setAppearance(a => fn(a));
    setActivePreset(null);
  }, []);
  const setOutfit = (patch: Partial<AvatarAppearance['outfit']>) => edit(a => ({ ...a, outfit: { ...a.outfit, ...patch } }));
  const setFace = (patch: Partial<AvatarAppearance['face']>) => edit(a => ({ ...a, face: { ...a.face, ...patch } }));
  const setBody = (patch: Partial<AvatarAppearance['body']>) => edit(a => ({ ...a, body: { ...a.body, ...patch } }));

  const applyPreset = (i: number) => {
    const p = CHARACTER_PRESETS[i];
    if (!p) return;
    setAppearance(normalizeAppearance(p.appearance));
    setActivePreset(i);
    if (traitsFromPreset.current || personality.length === 0) { setPersonality(p.personality.slice(0, MAX_TRAITS)); traitsFromPreset.current = true; }
  };
  const randomize = () => {
    const n = randomClicks + 1;
    setRandomClicks(n);
    setAppearance(randomAppearance(n));
    setActivePreset(null);
  };
  const reset = () => {
    setAppearance(initial.appearance);
    setPersonality(initial.personality);
    traitsFromPreset.current = initial.personality.length === 0;
    setActivePreset(CHARACTER_PRESETS.findIndex(p => keyOf(p.appearance) === keyOf(initial.appearance)) >= 0
      ? CHARACTER_PRESETS.findIndex(p => keyOf(p.appearance) === keyOf(initial.appearance)) : null);
  };
  const toggleTrait = (id: string) => { traitsFromPreset.current = false; setPersonality(list => toggleCapped(list, id, MAX_TRAITS)); };
  const toggleAccessory = (id: string) => edit(a => ({ ...a, accessories: toggleCapped(a.accessories, id, MAX_ACCESSORIES) }));

  const [saved, setSaved] = useState(false);
  const savedTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(savedTimer.current), []);
  const save = () => {
    const a = normalizeAppearance(appearance);
    const traits = sanitizeTraits(personality);
    onSave(a);
    onSaveCharacter?.({ appearance: a, personality: traits, displayName });
    // Visible confirmation for hosts that keep the creator open after saving.
    setSaved(true);
    window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSaved(false), 1600);
  };

  // ---- preview commands
  const playExpression = (name: PreviewExpression) => {
    setExpression({ name, nonce: ++nonce.current });
    setFlash(f => ({ ...f, expr: name }));
    window.clearTimeout(flashTimers.current.expr);
    flashTimers.current.expr = window.setTimeout(() => setFlash(f => ({ ...f, expr: null })), name === 'blink' ? 800 : 2300);
  };
  const playAnimation = (name: 'idle' | 'wave' | 'dance' | 'walk') => {
    if (name === 'wave') {
      setGesture({ name: 'wave', nonce: ++nonce.current });
      setFlash(f => ({ ...f, wave: true }));
      window.clearTimeout(flashTimers.current.wave);
      flashTimers.current.wave = window.setTimeout(() => setFlash(f => ({ ...f, wave: false })), 2600);
      return;
    }
    setBase(name);
  };
  const pickCamera = (id: CameraPreset) => { setCamera(id); setCameraNonce(n => n + 1); };
  // Smart framing (inZOI-style): face edits are tiny at full-body zoom, so engaging
  // the Face section frames the face — once, and only from the full-body view, so a
  // user who deliberately goes back to full body is never overridden.
  const autoFramed = useRef(false);
  const frameFace = () => {
    if (autoFramed.current || !support.face) return;
    autoFramed.current = true;
    if (camera === 'full') pickCamera('face');
  };

  // ---- category nav + scroll spy
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState<SectionId>('presets');
  const secId = (id: SectionId) => `hwc-${uid}-${id}`;
  const jumpTo = (id: SectionId) => {
    const box = scrollRef.current;
    const el = box?.querySelector<HTMLElement>(`[data-section="${id}"]`);
    if (!box || !el) return;
    box.scrollTo({ top: Math.max(0, el.offsetTop - 4), behavior: 'smooth' });
    setActiveSection(id);
  };
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const secs = Array.from(box.querySelectorAll<HTMLElement>('[data-section]'));
        const y = box.scrollTop + 48;
        let current: SectionId = 'presets';
        for (const s of secs) if (s.offsetTop <= y) current = s.dataset.section as SectionId;
        if (box.scrollTop + box.clientHeight >= box.scrollHeight - 4) current = (secs[secs.length - 1]?.dataset.section as SectionId) ?? current;
        setActiveSection(prev => (prev === current ? prev : current));
      });
    };
    box.addEventListener('scroll', onScroll, { passive: true });
    return () => { box.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, []);

  const bottomColor = (id: string) => BOTTOMS.find(b => b.id === id)?.color ?? '#555';
  const shoeColor = (id: string) => SHOES.find(s => s.id === id)?.color ?? '#555';
  const traitLabel = (id: string) => PERSONALITY_TRAITS.find(t => t.id === id)?.label ?? id;
  const editingExisting = Boolean(props.initialAppearance);

  return (
    <div className={cls('hwc-root', className)} role="region" aria-label="Character creator" data-testid="avatar-creator">
      <style>{CREATOR_CSS}</style>
      <div className="hwc-layout">
        {/* ------------------------------------------------ preview */}
        <div className="hwc-stage" ref={stageRef} data-testid="creator-stage">
          <CreatorPreview appearance={appearance} appearanceKey={appearanceKey} camera={camera} cameraNonce={cameraNonce}
            autoRotate={autoRotate} base={base} gesture={gesture} expression={expression} accent={ACCENT} loadingEl={loadingEl} insets={insets}
            onRigReady={onRigReady} />
          <div className="hwc-stage-top" ref={topRef}>
            <div className="hwc-brand">
              <span className="hwc-eyebrow">Hello World</span>
              <span className="hwc-title">Character Studio</span>
              <span className="hwc-badge"><i />{baseEntry ? baseName : 'Custom'}{realistic ? ' · Photoreal' : vrm ? ' · VRM guest' : ' body'}</span>
              <span className="hwc-hint" aria-hidden="true">Drag to rotate · scroll or pinch to zoom</span>
            </div>
            <div className="hwc-tools">
              <div className="hwc-seg" role="group" aria-label="Camera framing">
                {CAMERA_BUTTONS.map(c => (
                  <button key={c.id} type="button" className={cls(camera === c.id && 'is-on')} aria-pressed={camera === c.id}
                    aria-label={`Camera: ${c.label}`} data-testid={`cam-${c.id}`} onClick={() => pickCamera(c.id)}>
                    {c.id === 'face' ? c.label : <><span>{c.short}</span><span className="hwc-seg-long"> body</span></>}
                  </button>
                ))}
              </div>
              <button type="button" className={cls('hwc-iconbtn', autoRotate && 'is-on')} aria-pressed={autoRotate}
                aria-label={autoRotate ? 'Stop turntable rotation' : 'Auto-rotate turntable'} title="Auto-rotate"
                data-testid="cam-autorotate" onClick={() => setAutoRotate(v => !v)}>
                <Icon name="rotate" size={17} />
              </button>
            </div>
          </div>
          <div className="hwc-loading" ref={loadingEl} aria-hidden="true" data-testid="creator-loading"><i /><span>Loading…</span></div>
          <div className="hwc-dock" ref={dockRef}>
            <div className="hwc-dock-row" role="group" aria-label="Preview expression">
              <span className="hwc-dock-label">Expression</span>
              {EXPRESSION_BUTTONS.map(x => (
                <button key={x.name} type="button" className={cls('hwc-pill', flash.expr === x.name && 'is-on')} aria-pressed={flash.expr === x.name}
                  aria-label={`Preview ${x.label.toLowerCase()} expression`} data-testid={`expr-${x.name}`} onClick={() => playExpression(x.name)}>
                  <span className="hwc-emo" aria-hidden="true">{x.emo}</span>{x.label}
                </button>
              ))}
            </div>
            <div className="hwc-dock-row" role="group" aria-label="Preview animation">
              <span className="hwc-dock-label">Animation</span>
              {ANIMATION_BUTTONS.map(x => {
                const on = x.name === 'wave' ? flash.wave : base === x.name;
                return (
                  <button key={x.name} type="button" className={cls('hwc-pill', on && 'is-on')} aria-pressed={on}
                    aria-label={`Preview ${x.label.toLowerCase()} animation`} data-testid={`anim-${x.name}`} onClick={() => playAnimation(x.name)}>
                    {x.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ------------------------------------------------ panel */}
        <aside className="hwc-panel" aria-label="Character options">
          <header className="hwc-head">
            <div className="hwc-avatar-dot" aria-hidden="true">
              <Bust hair={appearance.hairStyle} hairColor={appearance.hairColor} skin={appearance.skinTone} outfit={appearance.outfit.color} eye={appearance.face.eyeColor} size={42} />
            </div>
            <div className="hwc-head-text">
              <div className="hwc-head-kicker">{editingExisting ? 'Editing character' : 'New character'}</div>
              <div className="hwc-head-name" data-testid="creator-name">{displayName}</div>
              <div className="hwc-head-traits" aria-label="Chosen personality">
                {personality.length ? personality.map(t => <span key={t}>{traitLabel(t)}</span>) : <em>No personality picked yet</em>}
              </div>
            </div>
          </header>
          <nav className="hwc-nav" aria-label="Creator sections">
            {SECTIONS.map(s => (
              <button key={s.id} type="button" className={cls(activeSection === s.id && 'is-on')} aria-current={activeSection === s.id ? 'true' : undefined}
                aria-controls={secId(s.id)} data-testid={`nav-${s.id}`} onClick={() => jumpTo(s.id)}>
                <Icon name={s.icon} size={16} /><span>{s.label}</span>
              </button>
            ))}
          </nav>

          <div className="hwc-scroll" ref={scrollRef}>
            <Section id="presets" domId={secId('presets')} title="Start from a character" sub="Pick a look, then make it yours"
              action={<button type="button" className="hwc-mini" onClick={randomize} aria-label="Randomize appearance" data-testid="creator-randomize"><Icon name="dice" size={14} />Randomize</button>}>
              <div className="hwc-presets">
                {CHARACTER_PRESETS.map((p, i) => (
                  <button key={p.name} type="button" className={cls('hwc-preset', activePreset === i && 'is-on')} aria-pressed={activePreset === i}
                    aria-label={`Preset ${p.name}: ${p.tagline}`} data-testid={`preset-${i}`} onClick={() => applyPreset(i)}>
                    <span className="hwc-preset-art" style={{ '--c': p.appearance.outfit.color } as CSSProperties}>
                      <Bust hair={p.appearance.hairStyle} hairColor={p.appearance.hairColor} skin={p.appearance.skinTone} outfit={p.appearance.outfit.color} eye={p.appearance.face.eyeColor} size={58} />
                    </span>
                    <span className="hwc-preset-name">{p.name}</span>
                    <span className="hwc-preset-tag">{p.tagline}</span>
                  </button>
                ))}
              </div>
            </Section>

            <Section id="body" domId={secId('body')} title="Body" sub="Base body, proportions and skin">
              <div className="hwc-label" style={{ marginTop: 0 }}>Townie bodies <small>fully customisable</small></div>
              <div className="hwc-bases" role="group" aria-label="Townie base bodies">
                {BASE_MODELS.filter(m => m.kind !== 'vrm' && !isRealisticBase(m.id)).map(m => (
                  <BaseCard key={m.id} m={m} on={appearance.baseModelId === m.id} onPick={() => edit(a => ({ ...a, baseModelId: m.id }))} />
                ))}
              </div>
              {BASE_MODELS.some(m => m.kind === 'vrm' && !isRealisticBase(m.id)) && (
                <>
                  <div className="hwc-label">Guest avatars <small>VRM · fixed look</small></div>
                  <div className="hwc-bases" role="group" aria-label="VRM guest avatars">
                    {BASE_MODELS.filter(m => m.kind === 'vrm' && !isRealisticBase(m.id)).map(m => (
                      <BaseCard key={m.id} m={m} on={appearance.baseModelId === m.id} onPick={() => edit(a => ({ ...a, baseModelId: m.id }))} />
                    ))}
                  </div>
                </>
              )}
              {realBases.length > 0 && (
                <div className="hwc-real" role="group" aria-label="Realistic humans" data-testid="realistic-group">
                  <div className="hwc-real-head">
                    <span className="hwc-real-title">Realistic humans</span>
                    <span className="hwc-real-sub">Photoreal bodies · outfit colour, proportions &amp; accessories</span>
                  </div>
                  <div className="hwc-bases">
                    {realBases.map(m => (
                      <BaseCard key={m.id} m={m} tag={realisticTag(m.id)} on={appearance.baseModelId === m.id} onPick={() => edit(a => ({ ...a, baseModelId: m.id }))} />
                    ))}
                  </div>
                </div>
              )}
              <div className="hwc-label">Proportions</div>
              {support.body ? (
                <>
                  <Slider label="Height" value={appearance.body.height} ends={['Shorter', 'Taller']} testId="slider-height" onChange={v => setBody({ height: v })} />
                  <Slider label="Build" value={appearance.body.build} ends={['Slim', 'Sturdy']} testId="slider-build" onChange={v => setBody({ build: v })} />
                </>
              ) : <Note>{baseName} is {fixedWhy}; height and build are fixed.</Note>}
              <div className="hwc-label">Skin tone</div>
              {support.skinTone
                ? <Swatches label="Skin tone" colors={SKIN_TONES} value={appearance.skinTone} testIdPrefix="skin" onChange={c => edit(a => ({ ...a, skinTone: c }))} />
                : <Note>{baseName} is {fixedWhy}; its skin is part of the model. Skin tones apply to Townie bodies.</Note>}
            </Section>

            <Section id="face" domId={secId('face')} title="Face" sub={support.face ? 'Eyes and features' : 'Fixed by this body'} onEngage={frameFace}>
              {support.face ? (
                <>
                  <div className="hwc-label" style={{ marginTop: 0 }}>Eye colour</div>
                  <Swatches label="Eye colour" colors={EYE_COLORS} value={appearance.face.eyeColor} testIdPrefix="eye" onChange={c => setFace({ eyeColor: c })} />
                  <div className="hwc-label">Features</div>
                  <Slider label="Eye size" value={appearance.face.eyeSize} ends={['Small', 'Big']} testId="slider-eyes" onChange={v => setFace({ eyeSize: v })} />
                  <Slider label="Nose size" value={appearance.face.noseSize} ends={['Button', 'Bold']} testId="slider-nose" onChange={v => setFace({ noseSize: v })} />
                  <Slider label="Mouth size" value={appearance.face.mouthSize} ends={['Small', 'Wide']} testId="slider-mouth" onChange={v => setFace({ mouthSize: v })} />
                </>
              ) : <Note>{baseName} is {fixedWhy}, so eye colour and face shape stay as authored. Try the expression buttons on the preview.</Note>}
            </Section>

            <Section id="hair" domId={secId('hair')} title="Hair" sub={support.hair ? `${HAIR_STYLES.length} styles · any colour` : 'Fixed by this body'}>
              {support.hair ? (
                <>
              <div className="hwc-grid" role="group" aria-label="Hairstyle">
                  {HAIR_STYLES.map(h => (
                    <button key={h.id} type="button" className={cls('hwc-tile', appearance.hairStyle === h.id && 'is-on')} aria-pressed={appearance.hairStyle === h.id}
                      aria-label={`Hairstyle ${h.label}`} data-testid={`hair-${h.id}`} onClick={() => edit(a => ({ ...a, hairStyle: h.id }))}>
                      <Bust hair={h.id} hairColor={appearance.hairColor} skin={appearance.skinTone} outfit="rgba(255,255,255,.14)" eye={appearance.face.eyeColor} size={50} />
                      {h.label}
                    </button>
                  ))}
                </div>
                <div className="hwc-label">Hair colour</div>
                <Swatches label="Hair colour" colors={HAIR_COLORS} value={appearance.hairColor} testIdPrefix="hair-color" onChange={c => edit(a => ({ ...a, hairColor: c }))} />
                </>
              ) : <Note>{baseName} is {fixedWhy}; its hair is part of the model. Hairstyles and hair colours apply to Townie bodies.</Note>}
            </Section>

            <Section id="outfit" domId={secId('outfit')} title="Outfit" sub={support.outfitPieces ? 'Mix pieces, then pick a colour' : support.outfitColor ? 'Pick a colour' : 'Fixed by this body'}>
              {support.outfitPieces ? (
                <>
              <div className="hwc-label" style={{ marginTop: 0 }}>Top</div>
                <div className="hwc-chips" role="group" aria-label="Top">
                  {TOPS.map(t => (
                    <button key={t.id} type="button" className={cls('hwc-chip', appearance.outfit.top === t.id && 'is-on')} aria-pressed={appearance.outfit.top === t.id}
                      data-testid={`top-${t.id}`} onClick={() => setOutfit({ top: t.id })}><i style={{ '--dot': appearance.outfit.color } as CSSProperties} />{t.label}</button>
                  ))}
                </div>
                <div className="hwc-label">Bottom</div>
                <div className="hwc-chips" role="group" aria-label="Bottom">
                  {BOTTOMS.map(b => (
                    <button key={b.id} type="button" className={cls('hwc-chip', appearance.outfit.bottom === b.id && 'is-on')} aria-pressed={appearance.outfit.bottom === b.id}
                      data-testid={`bottom-${b.id}`} onClick={() => setOutfit({ bottom: b.id })}><i style={{ '--dot': bottomColor(b.id) } as CSSProperties} />{b.label}</button>
                  ))}
                </div>
                <div className="hwc-label">Shoes</div>
                <div className="hwc-chips" role="group" aria-label="Shoes">
                  {SHOES.map(s => (
                    <button key={s.id} type="button" className={cls('hwc-chip', appearance.outfit.shoes === s.id && 'is-on')} aria-pressed={appearance.outfit.shoes === s.id}
                      data-testid={`shoes-${s.id}`} onClick={() => setOutfit({ shoes: s.id })}><i style={{ '--dot': shoeColor(s.id) } as CSSProperties} />{s.label}</button>
                  ))}
                </div>
                </>
              ) : <Note>{baseName} wears its own outfit pieces — tops, bottoms and shoes apply to Townie bodies.</Note>}
              {support.outfitColor ? (
                <>
              <div className="hwc-label">Outfit colour <small>tints your top</small></div>
                <Swatches label="Outfit colour" colors={OUTFIT_COLORS} value={appearance.outfit.color} testIdPrefix="outfit-color" onChange={c => setOutfit({ color: c })} />
                </>
              ) : <Note>{baseName}'s outfit colours are fixed.</Note>}
            </Section>

            <Section id="extras" domId={secId('extras')} title="Accessories" sub={`${appearance.accessories.length}/${MAX_ACCESSORIES} equipped`}>
              {support.accessories ? (
                <>
              <div className="hwc-chips" role="group" aria-label="Accessories">
                  {ACCESSORIES.map(x => {
                    const on = appearance.accessories.includes(x.id);
                    return (
                      <button key={x.id} type="button" className={cls('hwc-chip', on && 'is-on')} aria-pressed={on} data-testid={`acc-${x.id}`} onClick={() => toggleAccessory(x.id)}>
                        <span className="hwc-check" aria-hidden="true">{on && <Icon name="check" size={11} />}</span>{x.label}
                      </button>
                    );
                  })}
                </div>
                {appearance.accessories.length >= MAX_ACCESSORIES && <div className="hwc-note">Max {MAX_ACCESSORIES} — picking another swaps out the oldest.</div>}
                </>
              ) : <Note>{baseName} can't wear accessories.</Note>}
            </Section>

            <Section id="personality" domId={secId('personality')} title="Personality" sub={`Pick up to ${MAX_TRAITS} · shapes how they live in town (${personality.length}/${MAX_TRAITS})`}>
              <div className="hwc-traits" role="group" aria-label="Personality traits">
                {PERSONALITY_TRAITS.map(t => {
                  const idx = personality.indexOf(t.id);
                  return (
                    <button key={t.id} type="button" className={cls('hwc-trait', idx >= 0 && 'is-on')} aria-pressed={idx >= 0}
                      aria-label={`${t.label}: ${t.description}`} data-testid={`trait-${t.id}`} onClick={() => toggleTrait(t.id)}>
                      <b>{idx >= 0 && <span className="hwc-trait-n" aria-hidden="true">{idx + 1}</span>}{t.label}</b>
                      <small>{t.description}</small>
                    </button>
                  );
                })}
              </div>
            </Section>
          </div>

          <footer className="hwc-foot">
            <button type="button" className="hwc-btn" onClick={reset} disabled={!dirty} aria-label="Reset to initial look" data-testid="creator-reset" title="Reset">
              <Icon name="reset" size={15} /><span>Reset</span>
            </button>
            {onCancel && (
              <button type="button" className="hwc-btn" onClick={onCancel} data-testid="creator-cancel">Cancel</button>
            )}
            <button type="button" className="hwc-btn hwc-btn-primary" onClick={save} data-testid="creator-save" aria-live="polite">
              <Icon name="check" size={16} />{saved ? 'Saved!' : 'Save Character'}
            </button>
          </footer>
        </aside>
      </div>
    </div>
  );
}
