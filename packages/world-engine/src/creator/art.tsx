/**
 * Tiny inline-SVG illustrations for the creator UI (hairstyle tiles, preset
 * busts, section icons). Pure presentational, no assets, no network.
 */
import type { ReactNode } from 'react';

type HairArt = { back?: ReactNode; front?: ReactNode };

function hairArt(style: string, c: string): HairArt {
  const fringe = <path d="M14 21 C14 13 19 10 24 10 C30 10 34 13 34 21 C31 17 27 15.6 24 15.6 C20.5 15.6 17 17 14 21 Z" fill={c} />;
  switch (style) {
    case 'buzz':
      return { front: <path d="M14.4 19.5 C14.8 13.2 19 11.2 24 11.2 C29 11.2 33.2 13.2 33.6 19.5 C30.5 16.4 27.2 15.7 24 15.7 C20.8 15.7 17.5 16.4 14.4 19.5 Z" fill={c} opacity={0.62} /> };
    case 'bob':
      return { back: <path d="M12.5 22 C12.5 12 18 9 24 9 C30 9 35.5 12 35.5 22 L35.5 31 C33.5 32 31.5 31.6 30.5 30.5 L17.5 30.5 C16.5 31.6 14.5 32 12.5 31 Z" fill={c} />, front: fringe };
    case 'long':
      return { back: <path d="M12 22 C12 11.5 18 9 24 9 C30 9 36 11.5 36 22 L37 43 C33 44.5 30 44 29 42 L19 42 C18 44 15 44.5 11 43 Z" fill={c} />, front: fringe };
    case 'ponytail':
      return { back: <path d="M31 14 C40 15 42 26 38.5 37 C37 31 35.5 25 31.5 21 Z" fill={c} />, front: fringe };
    case 'bun':
      return { back: <circle cx={24} cy={8.2} r={5.2} fill={c} />, front: fringe };
    case 'curly':
      return {
        front: <g fill={c}>{[[14.2, 19.5], [15.8, 13.8], [20.2, 10.4], [27.8, 10.4], [32.2, 13.8], [33.8, 19.5], [24, 9.4]].map(([x, y], i) =>
          <circle key={i} cx={x} cy={y} r={4.4} />)}</g>,
      };
    case 'afro':
      return { back: <circle cx={24} cy={18.5} r={14.5} fill={c} />, front: <path d="M14.5 19 C15 13 19 11.5 24 11.5 C29 11.5 33 13 33.5 19 C30 16.5 27 16 24 16 C21 16 18 16.5 14.5 19 Z" fill={c} /> };
    case 'spiky':
      return { front: <path d="M13.2 21 L13.6 12.5 L17.8 14.6 L19.2 6.8 L23.4 11.6 L27.6 5.8 L29.6 12.6 L34.2 9.8 L34.8 21 C31 17 27.2 15.8 24 15.8 C20.6 15.8 17 17 13.2 21 Z" fill={c} /> };
    case 'mohawk':
      return { front: <g><path d="M14.5 19.5 C15 14 19 12 24 12 C29 12 33 14 33.5 19.5 C30 16.5 27 16 24 16 C21 16 18 16.5 14.5 19.5 Z" fill={c} opacity={0.35} /><path d="M21.2 16 L21.6 5.2 C23 2.6 25 2.6 26.4 5.2 L26.8 16 Z" fill={c} /></g> };
    case 'braids':
      return {
        back: <g stroke={c} strokeWidth={4.2} strokeLinecap="round" strokeDasharray="3.2 1.1" fill="none"><path d="M14.4 22 L13.2 42" /><path d="M33.6 22 L34.8 42" /></g>,
        front: fringe,
      };
    case 'bald':
      return { front: <ellipse cx={20} cy={15.5} rx={3.2} ry={1.8} fill="#fff" opacity={0.28} /> };
    case 'short':
    default:
      return { front: fringe };
  }
}

/** Head-and-shoulders bust in the given colours and hairstyle. */
export function Bust({ hair, hairColor, skin, outfit, size = 48, eye = '#2b2233' }: {
  hair: string; hairColor: string; skin: string; outfit: string; size?: number; eye?: string;
}) {
  const art = hairArt(hair, hairColor);
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      {art.back}
      <path d="M8 48 C8 38 14.5 33.5 24 33.5 C33.5 33.5 40 38 40 48 Z" fill={outfit} />
      <rect x={21} y={28} width={6} height={7} rx={2} fill={skin} />
      <circle cx={24} cy={21.5} r={10} fill={skin} />
      <circle cx={20.6} cy={23} r={1.15} fill={eye} />
      <circle cx={27.4} cy={23} r={1.15} fill={eye} />
      <path d="M21.6 26.6 Q24 28.4 26.4 26.6" stroke={eye} strokeWidth={0.9} fill="none" strokeLinecap="round" opacity={0.7} />
      {art.front}
    </svg>
  );
}

/** Stylised silhouette for a base body type, scaled by its feel. */
export function BodyGlyph({ id, color }: { id: string; color: string }) {
  const dims: Record<string, { sh: number; w: number; h: number; head: number }> = {
    'townie-classic': { sh: 9, w: 6, h: 30, head: 5 },
    'townie-sporty': { sh: 11.5, w: 6.5, h: 31, head: 4.8 },
    'townie-soft': { sh: 10, w: 9, h: 28, head: 5.4 },
    'townie-tall': { sh: 8.5, w: 5, h: 34, head: 4.6 },
    'townie-petite': { sh: 7.5, w: 5.5, h: 25, head: 5.8 },
  };
  const d = dims[id] ?? { sh: 9, w: 6.5, h: 30, head: 5 };
  const top = 44 - d.h;
  return (
    <svg width={40} height={48} viewBox="0 0 40 48" aria-hidden="true" focusable="false">
      <circle cx={20} cy={top + d.head} r={d.head} fill={color} opacity={0.95} />
      <path d={`M${20 - d.sh} ${top + d.head * 2 + 3} Q20 ${top + d.head * 2} ${20 + d.sh} ${top + d.head * 2 + 3}
        L${20 + d.w} ${top + d.h * 0.66} L${20 + d.w * 0.8} 44 L${20 - d.w * 0.8} 44 L${20 - d.w} ${top + d.h * 0.66} Z`} fill={color} opacity={0.75} />
    </svg>
  );
}

const ICON_PATHS: Record<string, ReactNode> = {
  presets: <path d="M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v6H4zM13 14h7v6h-7z" />,
  body: <path d="M12 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM7 10h10l-1.5 5H14l-.5 6h-3l-.5-6H8.5z" />,
  face: <path d="M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm-3 7.2a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zm6 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zM8.5 15c1.8 2 5.2 2 7 0" />,
  hair: <path d="M4 14c0-6 3.6-10 8-10s8 4 8 10v6h-3v-7c-2-1-4.5-3-5-5-1 2.5-4 4.5-5 5v7H4z" />,
  outfit: <path d="M8 3l4 2 4-2 5 4-2.5 3.5L17 9.5V21H7V9.5l-1.5 1L3 7z" />,
  extras: <path d="M3 13a3.5 3.5 0 1 0 7 0 3.5 3.5 0 0 0-7 0zm11 0a3.5 3.5 0 1 0 7 0 3.5 3.5 0 0 0-7 0zM10 12.2c1.2-.8 2.8-.8 4 0" />,
  personality: <path d="M12 20.5s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.9c0 5.4-7.5 10-7.5 10z" />,
  dice: <path d="M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm3 3a1.3 1.3 0 1 0 0 2.6A1.3 1.3 0 0 0 8 7zm8 0a1.3 1.3 0 1 0 0 2.6A1.3 1.3 0 0 0 16 7zm-4 3.7a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6zM8 14.4A1.3 1.3 0 1 0 8 17a1.3 1.3 0 0 0 0-2.6zm8 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z" />,
  rotate: <path d="M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z" />,
  reset: <path d="M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z" />,
  check: <path d="M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6L20.5 8l-1.4-1.4z" />,
  chevron: <path d="M12 8.2 4.9 15.3l1.4 1.4 5.7-5.7 5.7 5.7 1.4-1.4z" />,
  pipette: <path d="M19.4 4.6a2.6 2.6 0 0 0-3.7 0l-2.5 2.5-1.4-1.4-1.4 1.4 1.4 1.4L5 15.3V19h3.7l6.8-6.8 1.4 1.4 1.4-1.4-1.4-1.4 2.5-2.5a2.6 2.6 0 0 0 0-3.7zM7.9 17H7v-.9l6.8-6.8.9.9z" />,
};

export function Icon({ name, size = 16 }: { name: keyof typeof ICON_PATHS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      {ICON_PATHS[name] ?? null}
    </svg>
  );
}
