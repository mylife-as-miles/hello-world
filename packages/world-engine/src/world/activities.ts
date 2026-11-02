/**
 * Shared activity vocabulary. The contract's `ResidentProfile.activity` is a
 * free string; this engine writes human-readable phrases whose FIRST WORD is
 * one of these verbs, e.g. "walking to Sunbeam Café", "chatting with Nova".
 * The renderer maps the verb to an animation; unknown strings render idle.
 * PURE DATA — Node-safe.
 */
export const ACTIVITY_VERBS = [
  'idle', 'walking', 'running', 'chatting', 'greeting', 'complimenting', 'befriending',
  'waving', 'dancing', 'celebrating', 'cheering', 'gifting', 'thanking', 'laughing',
  'resting', 'sitting', 'sleeping', 'drinking', 'eating', 'playing', 'reading',
  'admiring', 'watching', 'arriving', 'leaving', 'sulking', 'thinking', 'wandering',
] as const;

export type ActivityVerb = typeof ACTIVITY_VERBS[number];

const VERB_SET = new Set<string>(ACTIVITY_VERBS);

export function formatActivity(verb: ActivityVerb, detail?: string): string {
  return detail ? `${verb} ${detail}` : verb;
}

/** First word of an activity string, lowercased; unknown/blank → 'idle'. */
export function parseActivityVerb(activity: string | undefined | null): ActivityVerb {
  if (!activity) return 'idle';
  const first = activity.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? '';
  return (VERB_SET.has(first) ? first : 'idle') as ActivityVerb;
}

/** Coarse animation families the renderer implements. */
export type AnimationFamily =
  | 'idle' | 'walk' | 'run' | 'talk' | 'wave' | 'dance' | 'celebrate' | 'give'
  | 'sit' | 'sleep' | 'play' | 'sad' | 'think' | 'laugh';

export function animationForVerb(verb: ActivityVerb): AnimationFamily {
  switch (verb) {
    case 'walking': case 'wandering': case 'leaving': return 'walk';
    case 'running': case 'arriving': return 'run';
    case 'chatting': case 'greeting': case 'complimenting': case 'befriending': case 'thanking': return 'talk';
    case 'waving': return 'wave';
    case 'dancing': return 'dance';
    case 'celebrating': case 'cheering': return 'celebrate';
    case 'gifting': return 'give';
    case 'resting': case 'sitting': case 'drinking': case 'eating': case 'reading': return 'sit';
    case 'sleeping': return 'sleep';
    case 'playing': return 'play';
    case 'sulking': return 'sad';
    case 'thinking': case 'admiring': case 'watching': return 'think';
    case 'laughing': return 'laugh';
    default: return 'idle';
  }
}
