/**
 * Scoped creator styles. Every selector is prefixed with `.hwc-` (HELLO WORLD
 * creator) so nothing leaks into the host app. Layout responds to the
 * creator's own size via container queries (not the viewport), so it works
 * full-screen, in a modal or in a side pane.
 */
export const CREATOR_CSS = /* css */ `
.hwc-root {
  --hwc-accent: #a28fff;
  --hwc-accent-2: #ff8fbc;
  --hwc-accent-soft: rgba(162, 143, 255, 0.16);
  --hwc-text: #f4f2fb;
  --hwc-muted: rgba(236, 232, 250, 0.62);
  --hwc-faint: rgba(236, 232, 250, 0.38);
  --hwc-line: rgba(255, 255, 255, 0.085);
  --hwc-card: rgba(255, 255, 255, 0.045);
  --hwc-card-hover: rgba(255, 255, 255, 0.085);
  --hwc-glass: rgba(20, 18, 33, 0.74);
  position: relative; width: 100%; height: 100%; min-height: 0; overflow: hidden;
  container-type: inline-size; container-name: hwc;
  color: var(--hwc-text);
  font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 13px; line-height: 1.35; -webkit-font-smoothing: antialiased;
  background:
    radial-gradient(70% 60% at 32% 34%, rgba(176, 156, 255, 0.30) 0%, rgba(176, 156, 255, 0) 70%),
    radial-gradient(60% 50% at 18% 100%, rgba(255, 143, 188, 0.16) 0%, rgba(255, 143, 188, 0) 70%),
    linear-gradient(180deg, #34305a 0%, #1f1c36 48%, #110f1e 100%);
  box-sizing: border-box;
}
.hwc-root *, .hwc-root *::before, .hwc-root *::after { box-sizing: border-box; }
.hwc-root button { font: inherit; color: inherit; }
.hwc-root :focus { outline: none; }
.hwc-root :focus-visible { outline: 2px solid #ffffff; outline-offset: 2px; }

.hwc-layout { position: absolute; inset: 0; display: grid; grid-template-columns: minmax(0, 1fr) clamp(360px, 38%, 470px); grid-template-rows: minmax(0, 1fr); }

/* ---------------- stage ---------------- */
.hwc-stage { position: relative; min-width: 0; min-height: 0; }
.hwc-canvas { position: absolute !important; inset: 0; touch-action: none; }
.hwc-stage-top { position: absolute; top: 18px; left: 20px; right: 20px; display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; pointer-events: none; z-index: 2; }
.hwc-stage-top > * { pointer-events: auto; }
.hwc-brand { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.hwc-eyebrow { font-size: 10.5px; letter-spacing: 0.22em; text-transform: uppercase; color: var(--hwc-muted); font-weight: 600; }
.hwc-title { font-size: 21px; font-weight: 650; letter-spacing: -0.01em; white-space: nowrap; }
.hwc-badge { display: inline-flex; align-items: center; gap: 6px; margin-top: 6px; font-size: 11.5px; color: var(--hwc-muted); }
.hwc-badge i { width: 7px; height: 7px; border-radius: 50%; background: var(--hwc-accent); box-shadow: 0 0 10px var(--hwc-accent); }
.hwc-tools { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
.hwc-seg { display: inline-flex; padding: 4px; gap: 2px; border-radius: 999px; background: rgba(14, 12, 25, 0.55); border: 1px solid var(--hwc-line); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); }
.hwc-seg button { border: 0; background: transparent; color: var(--hwc-muted); padding: 7px 13px; border-radius: 999px; font-size: 12px; font-weight: 550; cursor: pointer; transition: background .2s, color .2s; white-space: nowrap; }
.hwc-seg button:hover { color: var(--hwc-text); }
.hwc-seg button.is-on { background: rgba(255, 255, 255, 0.16); color: #fff; box-shadow: inset 0 1px 0 rgba(255,255,255,.12); }
.hwc-iconbtn { width: 38px; height: 38px; display: inline-grid; place-items: center; border-radius: 50%; border: 1px solid var(--hwc-line); background: rgba(14, 12, 25, 0.55); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); color: var(--hwc-muted); cursor: pointer; transition: color .2s, background .2s, border-color .2s; }
.hwc-iconbtn:hover { color: #fff; }
.hwc-iconbtn.is-on { color: #fff; border-color: var(--hwc-accent); background: var(--hwc-accent-soft); }
.hwc-iconbtn.is-on svg { animation: hwc-spin 2.4s linear infinite; }
@keyframes hwc-spin { to { transform: rotate(360deg); } }

.hwc-dock { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 8px; width: max-content; max-width: calc(100% - 24px); z-index: 2; }
.hwc-dock-row { display: flex; align-items: center; gap: 4px; padding: 5px; max-width: 100%; overflow-x: auto; scrollbar-width: none; border-radius: 16px; background: rgba(14, 12, 25, 0.58); border: 1px solid var(--hwc-line); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); box-shadow: 0 10px 30px rgba(6, 4, 18, 0.35); }
.hwc-dock-row::-webkit-scrollbar { display: none; }
.hwc-dock-label { flex: none; padding: 0 8px 0 9px; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--hwc-faint); font-weight: 650; }
.hwc-pill { flex: none; display: inline-flex; align-items: center; gap: 6px; border: 1px solid transparent; background: transparent; color: var(--hwc-muted); padding: 7px 11px; border-radius: 11px; font-size: 12px; font-weight: 550; cursor: pointer; transition: background .18s, color .18s, border-color .18s, transform .18s; white-space: nowrap; }
.hwc-pill:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
.hwc-pill:active { transform: scale(0.96); }
.hwc-pill.is-on { background: var(--hwc-accent-soft); border-color: rgba(162, 143, 255, 0.55); color: #fff; }
.hwc-pill .hwc-emo { font-size: 13px; line-height: 1; }
.hwc-dock-note { flex: none; padding: 7px 10px; font-size: 11.5px; color: var(--hwc-muted); white-space: nowrap; }
.hwc-hint { margin-top: 4px; font-size: 11px; color: var(--hwc-faint); pointer-events: none; }
.hwc-loading { position: absolute; left: 50%; top: 46%; transform: translate(-50%, -50%); display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 999px; background: rgba(14, 12, 25, 0.7); border: 1px solid var(--hwc-line); font-size: 12px; color: var(--hwc-muted); opacity: 0; transition: opacity .25s; pointer-events: none; z-index: 3; }
.hwc-loading.is-on { opacity: 1; }
.hwc-stage.is-loading-heavy .hwc-loading { border-color: rgba(255, 214, 150, 0.4); color: #ffe6c4; background: rgba(28, 20, 14, 0.72); }
.hwc-stage.is-loading-heavy .hwc-loading i { border-top-color: #ffd29a; }
.hwc-stage.is-loading-heavy::after { content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 1;
  background: linear-gradient(105deg, transparent 35%, rgba(255, 236, 210, 0.08) 50%, transparent 65%); background-size: 250% 100%;
  animation: hwc-shimmer 1.5s ease-in-out infinite; }
@keyframes hwc-shimmer { from { background-position: 130% 0; } to { background-position: -130% 0; } }

.hwc-real { margin-top: 14px; padding: 12px; border-radius: 16px; border: 1px solid rgba(255, 214, 150, 0.24);
  background: linear-gradient(160deg, rgba(255, 214, 150, 0.08), rgba(162, 143, 255, 0.05)); }
.hwc-real-head { display: flex; flex-direction: column; gap: 2px; margin-bottom: 10px; }
.hwc-real-title { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; font-weight: 700; color: #ffdcae; }
.hwc-real-sub { font-size: 11.5px; color: var(--hwc-faint); }
.hwc-base .hwc-realtag { display: inline-block; margin-top: 4px; padding: 1px 6px; border-radius: 6px; font-size: 9.5px; font-weight: 700; letter-spacing: 0.04em; background: rgba(255, 214, 150, 0.16); color: #ffd9a6; }
.hwc-base-real.is-on { border-color: #ffd29a; background: rgba(255, 210, 154, 0.12); }
.hwc-base .hwc-credit { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.hwc-real-credits { display: flex; flex-direction: column; gap: 3px; margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(255, 214, 150, 0.14); }
.hwc-real-credits small { font-size: 10px; color: var(--hwc-faint); line-height: 1.35; }
.hwc-loading i { width: 12px; height: 12px; border-radius: 50%; border: 2px solid rgba(255,255,255,.2); border-top-color: var(--hwc-accent); animation: hwc-spin .8s linear infinite; }

/* ---------------- panel ---------------- */
.hwc-panel { position: relative; z-index: 4; display: flex; flex-direction: column; min-height: 0; margin: 14px 14px 14px 0; border-radius: 24px; overflow: hidden;
  background: linear-gradient(180deg, rgba(30, 27, 48, 0.80), rgba(17, 15, 29, 0.88));
  border: 1px solid rgba(255, 255, 255, 0.09);
  box-shadow: 0 30px 80px rgba(5, 3, 16, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.07);
  backdrop-filter: blur(22px) saturate(140%); -webkit-backdrop-filter: blur(22px) saturate(140%); }
.hwc-head { display: flex; align-items: center; gap: 12px; padding: 18px 20px 12px; }
.hwc-avatar-dot { flex: none; width: 42px; height: 42px; border-radius: 14px; display: grid; place-items: center; overflow: hidden;
  background: radial-gradient(circle at 50% 30%, rgba(255,255,255,.18), rgba(255,255,255,.04)); border: 1px solid var(--hwc-line); }
.hwc-head-text { min-width: 0; flex: 1; }
.hwc-head-kicker { font-size: 10.5px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--hwc-faint); font-weight: 650; }
.hwc-head-name { font-size: 19px; font-weight: 680; letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hwc-head-traits { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 4px; }
.hwc-head-traits span { font-size: 10.5px; padding: 2px 7px; border-radius: 999px; background: var(--hwc-accent-soft); color: #e4ddff; }
.hwc-head-traits em { font-style: normal; font-size: 11px; color: var(--hwc-faint); }

.hwc-nav { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(54px, 1fr); gap: 2px; padding: 2px 12px 10px; overflow-x: auto; scrollbar-width: none; border-bottom: 1px solid var(--hwc-line); flex: none; }
.hwc-nav::-webkit-scrollbar { display: none; }
.hwc-nav button { display: flex; flex-direction: column; align-items: center; gap: 4px; border: 1px solid transparent; background: transparent; color: var(--hwc-muted); padding: 8px 4px 7px; border-radius: 12px; font-size: 10.5px; font-weight: 650; letter-spacing: .01em; cursor: pointer; transition: background .18s, color .18s; white-space: nowrap; }
.hwc-nav button:hover { color: #fff; background: rgba(255,255,255,.05); }
.hwc-nav button.is-on { color: #fff; background: rgba(255, 255, 255, 0.1); border-color: rgba(255,255,255,.08); }
.hwc-nav button.is-dim { opacity: 0.45; }

.hwc-scroll { position: relative; flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scroll-behavior: smooth; padding-bottom: 12px; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.18) transparent; }
.hwc-sec { padding: 18px 20px 6px; }
.hwc-sec + .hwc-sec { border-top: 1px solid var(--hwc-line); margin-top: 10px; }
.hwc-sec-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.hwc-sec-title { margin: 0; font-size: 15px; font-weight: 650; letter-spacing: -0.005em; }
.hwc-sec-sub { font-size: 11.5px; color: var(--hwc-faint); }
.hwc-label { display: flex; align-items: baseline; justify-content: space-between; margin: 14px 0 8px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--hwc-muted); font-weight: 650; }
.hwc-label small { letter-spacing: 0; text-transform: none; font-weight: 500; color: var(--hwc-faint); font-size: 11.5px; }
.hwc-note { margin: 8px 0 4px; padding: 10px 12px; border-radius: 12px; font-size: 12px; color: var(--hwc-muted); background: rgba(255,255,255,.04); border: 1px dashed rgba(255,255,255,.12); }

.hwc-mini { display: inline-flex; align-items: center; gap: 6px; padding: 7px 11px; border-radius: 10px; border: 1px solid var(--hwc-line); background: var(--hwc-card); font-size: 12px; font-weight: 600; cursor: pointer; transition: background .18s, border-color .18s, transform .15s; }
.hwc-mini:hover { background: var(--hwc-card-hover); border-color: rgba(255,255,255,.16); }
.hwc-mini:active { transform: scale(0.97); }

.hwc-presets { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; }
.hwc-preset { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 10px 6px 10px; border-radius: 16px; border: 1px solid var(--hwc-line); background: var(--hwc-card); cursor: pointer; transition: background .2s, border-color .2s, transform .2s; }
.hwc-preset:hover { background: var(--hwc-card-hover); transform: translateY(-1px); }
.hwc-preset.is-on { border-color: var(--hwc-accent); background: var(--hwc-accent-soft); }
.hwc-preset-art { width: 60px; height: 60px; border-radius: 50%; display: grid; place-items: center; overflow: hidden; margin-bottom: 6px;
  background: radial-gradient(circle at 50% 35%, color-mix(in srgb, var(--c) 55%, #ffffff 10%), color-mix(in srgb, var(--c) 25%, #120f22)); }
.hwc-preset-name { font-size: 13px; font-weight: 650; }
.hwc-preset-tag { font-size: 11px; color: var(--hwc-faint); text-align: center; }

.hwc-bases { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.hwc-base { display: flex; align-items: center; gap: 8px; text-align: left; padding: 8px 10px 8px 6px; border-radius: 14px; border: 1px solid var(--hwc-line); background: var(--hwc-card); cursor: pointer; transition: background .2s, border-color .2s; }
.hwc-base:hover { background: var(--hwc-card-hover); }
.hwc-base.is-on { border-color: var(--hwc-accent); background: var(--hwc-accent-soft); }
.hwc-base b { display: block; font-size: 12.5px; font-weight: 650; }
.hwc-base small { display: block; font-size: 10.5px; color: var(--hwc-faint); line-height: 1.25; }
.hwc-base .hwc-credit { margin-top: 3px; font-size: 10px; color: #cfc6ff; }
.hwc-kind { display: inline-block; margin-left: 4px; padding: 0 5px; border-radius: 6px; font-size: 9.5px; font-weight: 700; letter-spacing: .06em; background: rgba(255,143,188,.2); color: #ffc2da; vertical-align: 1px; }

.hwc-swatches { display: flex; flex-wrap: wrap; gap: 8px; }
.hwc-swatch { position: relative; width: 30px; height: 30px; border-radius: 50%; border: 0; padding: 0; cursor: pointer; background: var(--sw);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.18), inset 0 -6px 10px rgba(0,0,0,.18); transition: transform .15s, box-shadow .15s; }
.hwc-swatch:hover { transform: scale(1.08); }
.hwc-swatch.is-on { box-shadow: 0 0 0 2px #17142a, 0 0 0 4px var(--hwc-accent), inset 0 -6px 10px rgba(0,0,0,.18); transform: scale(1.04); }
.hwc-swatch-custom { display: inline-grid; place-items: center; background: conic-gradient(#ff6b6b, #ffd93d, #6bff95, #4dd6ff, #8a7bff, #ff6bd6, #ff6b6b); }
.hwc-swatch-custom::after { content: ''; width: 16px; height: 16px; border-radius: 50%; background: var(--sw, #1c1930); box-shadow: 0 0 0 2px #1c1930; }
.hwc-swatch-custom input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; border: 0; padding: 0; }
.hwc-swatch-custom:focus-within { outline: 2px solid #fff; outline-offset: 2px; }

.hwc-grid { display: grid; gap: 7px; grid-template-columns: repeat(auto-fill, minmax(78px, 1fr)); }
.hwc-tile { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 7px 4px 8px; border-radius: 14px; border: 1px solid var(--hwc-line); background: var(--hwc-card); cursor: pointer; font-size: 11.5px; font-weight: 600; color: var(--hwc-muted); transition: background .18s, border-color .18s, color .18s; }
.hwc-tile:hover { background: var(--hwc-card-hover); color: #fff; }
.hwc-tile.is-on { border-color: var(--hwc-accent); background: var(--hwc-accent-soft); color: #fff; }

.hwc-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.hwc-chip { display: inline-flex; align-items: center; gap: 7px; padding: 7px 11px; border-radius: 11px; border: 1px solid var(--hwc-line); background: var(--hwc-card); font-size: 12.5px; font-weight: 550; color: var(--hwc-muted); cursor: pointer; transition: background .18s, border-color .18s, color .18s; }
.hwc-chip:hover { background: var(--hwc-card-hover); color: #fff; }
.hwc-chip.is-on { border-color: var(--hwc-accent); background: var(--hwc-accent-soft); color: #fff; }
.hwc-chip i { width: 10px; height: 10px; border-radius: 50%; background: var(--dot); box-shadow: inset 0 0 0 1px rgba(255,255,255,.25); }
.hwc-chip .hwc-check { width: 14px; height: 14px; border-radius: 5px; display: inline-grid; place-items: center; border: 1px solid rgba(255,255,255,.25); }
.hwc-chip.is-on .hwc-check { background: var(--hwc-accent); border-color: var(--hwc-accent); color: #160f24; }

.hwc-traits { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 7px; }
.hwc-trait { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; text-align: left; padding: 9px 11px; border-radius: 13px; border: 1px solid var(--hwc-line); background: var(--hwc-card); cursor: pointer; transition: background .18s, border-color .18s; }
.hwc-trait:hover { background: var(--hwc-card-hover); }
.hwc-trait b { font-size: 12.5px; font-weight: 650; display: flex; align-items: center; gap: 6px; }
.hwc-trait small { font-size: 11px; color: var(--hwc-faint); line-height: 1.3; }
.hwc-trait.is-on { border-color: var(--hwc-accent); background: var(--hwc-accent-soft); }
.hwc-trait.is-on small { color: var(--hwc-muted); }
.hwc-trait-n { display: inline-grid; place-items: center; width: 16px; height: 16px; border-radius: 50%; font-size: 10px; font-weight: 800; background: var(--hwc-accent); color: #160f24; }

.hwc-slider { display: block; margin: 4px 0 12px; }
.hwc-slider-head { display: flex; justify-content: space-between; font-size: 12.5px; font-weight: 600; margin-bottom: 7px; }
.hwc-slider-head output { font-variant-numeric: tabular-nums; color: var(--hwc-muted); font-weight: 500; font-size: 12px; }
.hwc-slider input { -webkit-appearance: none; appearance: none; width: 100%; height: 6px; border-radius: 999px; margin: 0; cursor: pointer;
  background: linear-gradient(90deg, var(--hwc-accent) 0%, var(--hwc-accent-2) var(--p), rgba(255,255,255,.12) var(--p)); }
.hwc-slider input::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,.4), 0 0 0 4px rgba(162,143,255,.25); transition: transform .15s; }
.hwc-slider input::-moz-range-thumb { width: 18px; height: 18px; border: 0; border-radius: 50%; background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,.4), 0 0 0 4px rgba(162,143,255,.25); }
.hwc-slider input:active::-webkit-slider-thumb { transform: scale(1.15); }
.hwc-slider input:focus-visible { outline: 2px solid #fff; outline-offset: 4px; }
.hwc-slider-ends { display: flex; justify-content: space-between; font-size: 10.5px; color: var(--hwc-faint); margin-top: 5px; }

.hwc-foot { flex: none; display: flex; gap: 8px; align-items: center; padding: 14px 16px 16px; border-top: 1px solid var(--hwc-line); background: rgba(10, 9, 18, 0.45); }
.hwc-btn { height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 0 15px; border-radius: 13px; font-size: 13.5px; font-weight: 650; cursor: pointer; border: 1px solid var(--hwc-line); background: transparent; color: var(--hwc-text); transition: background .18s, transform .15s, box-shadow .2s, opacity .2s; white-space: nowrap; }
.hwc-btn:hover { background: rgba(255,255,255,.07); }
.hwc-btn:active { transform: scale(0.98); }
.hwc-btn:disabled { opacity: .45; cursor: default; }
.hwc-btn-primary { flex: 1; border: 0; color: #1a1030; background: linear-gradient(135deg, #b9a8ff 0%, var(--hwc-accent) 45%, var(--hwc-accent-2) 100%); box-shadow: 0 10px 28px rgba(162, 143, 255, 0.38), inset 0 1px 0 rgba(255,255,255,.45); }
.hwc-btn-primary:hover { background: linear-gradient(135deg, #c6b8ff 0%, #ae9dff 45%, #ff9dc5 100%); box-shadow: 0 12px 32px rgba(162, 143, 255, 0.5), inset 0 1px 0 rgba(255,255,255,.5); }

/* ---------------- compact / mobile (creator width) ---------------- */
@container hwc (max-width: 760px) {
  .hwc-layout { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(250px, 44%) minmax(0, 1fr); }
  .hwc-panel { margin: -20px 0 0 0; border-radius: 24px 24px 0 0; border-bottom: 0; box-shadow: 0 -18px 50px rgba(5, 3, 16, 0.5), inset 0 1px 0 rgba(255,255,255,.08); }
  .hwc-panel::before { content: ''; position: absolute; top: 7px; left: 50%; width: 38px; height: 4px; margin-left: -19px; border-radius: 4px; background: rgba(255,255,255,.22); }
  .hwc-head { padding: 18px 16px 8px; }
  .hwc-head-name { font-size: 17px; }
  .hwc-nav { padding: 2px 8px 10px; grid-auto-columns: minmax(48px, 1fr); }
  .hwc-sec { padding: 16px 16px 4px; }
  .hwc-stage-top { top: 12px; left: 12px; right: 12px; }
  .hwc-title { font-size: 16px; }
  .hwc-eyebrow { font-size: 9.5px; }
  .hwc-badge { display: none; }
  .hwc-seg button { padding: 6px 9px; font-size: 11.5px; }
  .hwc-iconbtn { width: 34px; height: 34px; }
  .hwc-dock { bottom: 30px; gap: 6px; left: 0; right: 0; transform: none; width: auto; max-width: none; flex-direction: row; align-items: center; overflow-x: auto; scrollbar-width: none; padding: 0 12px; }
  .hwc-dock::-webkit-scrollbar { display: none; }
  .hwc-dock { -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 12px, #000 calc(100% - 28px), transparent 100%); mask-image: linear-gradient(90deg, transparent 0, #000 12px, #000 calc(100% - 28px), transparent 100%); }
  .hwc-dock-row { flex: none; padding: 4px; border-radius: 14px; overflow: visible; max-width: none; }
  .hwc-pill { padding: 6px 9px; font-size: 11.5px; }
  .hwc-dock-label { display: none; }
  .hwc-hint { display: none; }
  .hwc-foot { padding: 10px 12px calc(12px + env(safe-area-inset-bottom, 0px)); }
  .hwc-btn { height: 42px; padding: 0 12px; }
  .hwc-presets { gap: 7px; }
}
@container hwc (max-width: 420px) {
  .hwc-brand .hwc-title { display: none; }
  .hwc-seg-long { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .hwc-root *, .hwc-root *::before, .hwc-root *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; }
}
`;
