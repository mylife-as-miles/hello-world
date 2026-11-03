/**
 * Dialogue: deterministic, personality/relationship/weather/time-aware line
 * templates (always the default + fallback), with global anti-repetition, plus
 * an OPTIONAL async LLM provider whose lines are only ever added as extra chat
 * events (never state changes).
 */
import type { Weather } from '@hello-world/contracts';
import { POIS, type PoiDef } from '../world/layout';
import { worldClock, type WorldClock } from '../world/time';
import { cleanText, type Agent, type World } from './state';
import { distressNeed } from './needs';

type Bank = readonly string[];
type Vars = Record<string, string | undefined>;

export function fill(template: string, vars: Vars): string {
  return template.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? '').replace(/\s+([,.!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

export const LINE_REUSE_SECONDS = 180;

/** Pick from a bank, never reusing a template within ~3 sim-minutes town-wide (least-recently-used fallback). */
export function choose(w: World, key: string, bank: Bank, salt: string): string {
  const fresh: number[] = [];
  let lru = 0;
  let lruAt = Infinity;
  for (let i = 0; i < bank.length; i++) {
    const at = w.lineUsedAt.get(`${key}#${i}`);
    if (at === undefined || w.simTime - at >= LINE_REUSE_SECONDS) fresh.push(i);
    else if (at < lruAt) { lruAt = at; lru = i; }
  }
  const idx = fresh.length ? fresh[w.rng.int(fresh.length, `line:${key}`, salt)]! : lru;
  w.lineUsedAt.set(`${key}#${idx}`, w.simTime);
  if (w.lineUsedAt.size > 1500) for (const [k, at] of [...w.lineUsedAt]) if (w.simTime - at > LINE_REUSE_SECONDS) w.lineUsedAt.delete(k);
  return bank[idx]!;
}

/** Pick a template a given pair has never used (resets when exhausted) — e.g. apologies never repeat within a pair. */
export function choosePair(w: World, pair: string, key: string, bank: Bank, salt: string): string {
  let used = w.pairLines.get(pair);
  if (!used) { used = new Set(); w.pairLines.set(pair, used); if (w.pairLines.size > 600) w.pairLines.delete(w.pairLines.keys().next().value!); }
  let free = bank.map((_, i) => i).filter(i => !used!.has(`${key}#${i}`));
  if (!free.length) { for (let i = 0; i < bank.length; i++) used.delete(`${key}#${i}`); free = bank.map((_, i) => i); }
  const idx = free[w.rng.int(free.length, `pair-line:${key}`, salt)]!;
  used.add(`${key}#${idx}`);
  w.lineUsedAt.set(`${key}#${idx}`, w.simTime);
  return bank[idx]!;
}

/** True when the bank still has a template not used in the last ~3 minutes. */
export function hasFresh(w: World, key: string, bank: Bank): boolean {
  for (let i = 0; i < bank.length; i++) { const at = w.lineUsedAt.get(`${key}#${i}`); if (at === undefined || w.simTime - at >= LINE_REUSE_SECONDS) return true; }
  return false;
}

/** First source with a fresh template wins (keeps personality flavour); otherwise least-recently-used across all. */
export function chooseFrom(w: World, sources: Array<readonly [string, Bank]>, salt: string): string {
  for (const [key, bank] of sources) if (bank.length && hasFresh(w, key, bank)) return choose(w, key, bank, salt);
  let best: readonly [string, Bank] = sources[0]!;
  let bestAt = Infinity;
  for (const src of sources) for (let i = 0; i < src[1].length; i++) { const at = w.lineUsedAt.get(`${src[0]}#${i}`) ?? -Infinity; if (at < bestAt) { bestAt = at; best = src; } }
  return choose(w, best[0], best[1], salt);
}

function flavored(w: World, a: Agent, key: string, generic: Bank, byTrait: Partial<Record<string, Bank>>, p = 0.5, fallback?: readonly [string, Bank]): string {
  const traits = a.personality.filter(t => byTrait[t]);
  const grumpy = traits.includes('grumpy');
  const sources: Array<readonly [string, Bank]> = [];
  if (traits.length && w.rng.chance(grumpy ? 0.75 : p, `flavor:${key}`, a.id)) {
    const t = grumpy ? 'grumpy' : w.rng.pick(traits, `flavor-t:${key}`, a.id);
    sources.push([`${key}:${t}`, byTrait[t]!]);
  }
  sources.push([key, generic]);
  for (const t of traits) sources.push([`${key}:${t}`, byTrait[t]!]);
  if (fallback) sources.push(fallback);
  return chooseFrom(w, sources, a.id);
}

const first = (name: string) => name;

// ---------------------------------------------------------------------------
// Banks
// ---------------------------------------------------------------------------
const OPENERS: Record<WorldClock['period'], Bank> = {
  morning: [
    'Morning, {name}! Sleep okay?', 'Good morning, {name}! The air smells like cinnamon buns.', '{name}! Early bird, huh?',
    'Hey {name}, coffee first or chit-chat first?', 'Rise and shine, {name}!', 'Morning, {name}! Big plans today?',
    'Oh, good morning {name}! Fresh day, fresh start.', '{name}! You’re up early. Couldn’t sleep either?', 'Top of the morning, {name}!',
    'Hey {name}! The bakery just opened, I can smell it from here.',
  ],
  afternoon: [
    'Afternoon, {name}! What have you been up to?', 'Hey {name}! Perfect day for a stroll.', 'Oh hi, {name}! Fancy meeting you {at}.',
    '{name}! Just the person I wanted to see.', 'Heyyy {name}, how’s your day going?', '{name}! Long time no see. Like, an hour.',
    'Hi {name}! Taking a break too?', 'Hey {name}, got a minute?', '{name}! I was hoping I’d bump into someone fun.',
    'Afternoon, {name}. Busy day in town, huh?',
  ],
  evening: [
    'Evening, {name}! The lamps are flickering on.', 'Hey {name}, catching the golden hour?', '{name}! You heading to the stage tonight?',
    'Look who it is! Evening, {name}.', '{name}! Perfect evening for a wander, right?', 'Hey {name}, how was your day?',
    'Evening, {name}. I could use a little company.', '{name}! The sky’s putting on a show tonight.', 'Oh hey {name}, winding down too?',
    'Hi {name}! Dinner plans, or are we snacking again?',
  ],
  night: [
    'Still up, {name}? Me too.', 'Hey {name}... the stars are wild tonight.', 'Welcome to the night owl club, {name}.',
    '{name}! Fancy seeing you out this late.', 'Psst, {name}. The town is so pretty at night.', 'Can’t sleep either, {name}?',
    '{name}! Midnight snack run?', 'Evening, {name}... or is it morning now?', 'Hey {name}, listen to how quiet it is.',
    '{name}! The fountain sparkles at night, have you seen?',
  ],
};
const OPENERS_BY_TRAIT: Partial<Record<string, Bank>> = {
  grumpy: ['Oh. It’s you, {name}.', '{name}. Don’t make it weird.', 'Hmph. Hello, {name}.', '{name}. I suppose you want to chat.', 'Make it quick, {name}.'],
  shy: ['Oh! Um, hi {name}...', 'H-hey {name}. Nice to see you.', 'Hi {name}... I was hoping I’d see you.', 'Um. Hi. It’s me. Hi, {name}.'],
  playful: ['{name}! Tag, you’re it!', 'Psst, {name}. Wanna hear a secret? Kidding. Hi!', '{name}! Bet you can’t guess what I just saw.', 'Boo! Ha, got you, {name}!'],
  chaotic: ['{name}! I have SO much to tell you. Most of it is true.', '{name}!! Did you see that pigeon? Iconic.', '{name}, quick: cats or capes? Wrong. Both.', '{name}! I just invented a new sport. It’s mostly yelling.'],
  romantic: ['{name}, you’re glowing today!', 'Hello, {name}. This place suits you.', '{name}! You make this town look good.'],
  bookish: ['Hello, {name}. I just finished a chapter, perfect timing.', '{name}! I was reading about you. Kidding. Hi!', 'Ah, {name}. Just the person to discuss plot twists with.'],
  foodie: ['{name}! Have you tried the new pastries yet?', '{name}, I smell waffles. Do you smell waffles?', '{name}! Quick, rate your breakfast out of ten.'],
  competitive: ['{name}. Rematch at the arcade later?', '{name}! Ready to lose at Star Blaster again?', '{name}! I’ve been practicing. Be afraid.'],
  energetic: ['{name}! Race you to the fountain!', '{name}! Isn’t today amazing?!', '{name}! I’ve been up for hours! Hi!'],
  kind: ['{name}! I hope your day has been lovely.', 'Hi {name}! You look like you could use a friend.', '{name}! I saved you a smile. Here it is.'],
  curious: ['{name}! Did you know the fountain hums at night?', '{name}, ever wonder where the portal goes?', '{name}! Have you ever counted the lamps in town? I have.'],
  friendly: ['{name}! Always great to see you!', 'Hey hey, {name}!', '{name}! There’s my favorite neighbor!'],
  creative: ['{name}! I just had the best idea for a dance move.', '{name}, the light here is gorgeous today.', '{name}! Hold still, I want to remember this color.'],
  lazy: ['Oh hey {name}. Don’t mind me, just conserving energy.', '{name}... is it nap o’clock yet?', 'Hi {name}. I walked all the way here. Exhausting.'],
  'night-owl': ['The night is young, {name}!', '{name}! Finally, someone who gets it. Night is the best.'],
};

const OPENERS_ANY: Bank = [
  'Hey, {name}! Got a sec?', 'Oh! {name}! Hi!', 'There you are, {name}!', '{name}! How’s life treating you?', 'Well hello, {name}!',
  'Hi {name}! What’s the latest?', 'Hey {name}, you’ll never guess my day.', '{name}! Come here, I need an opinion.', 'Ahoy, {name}!', 'Hiya, {name}! Fancy a chat?',
];
const RESPONSES_ANY: Bank = [
  'Oh! Hi there, {name}.', 'Hey, {name}! Nice to see a friendly face.', '{name}! What a nice surprise.', 'Hello hello, {name}!',
  'Well, if it isn’t {name}!', 'Hi {name}! How are things?', 'Hey {name}! Good timing.', '{name}! Long time, no chat.',
];
const AGREE: Bank = [
  'Totally!', 'Right?!', 'Couldn’t agree more.', 'Ha! Exactly.', 'So true.', 'I was just thinking that!',
  'Yes! A hundred percent.', 'Love that.', 'Same here!', 'You always say the best things.',
];
const DISTRESS_OPENERS: Record<'energy' | 'social' | 'fun', Bank> = {
  energy: ['*yawn* Oh, hey {name}.', 'Hi {name}... sorry, I’m half asleep.', 'Hey {name}. Running on fumes here.', 'Mm, {name}. Is it bedtime yet?', '{name}... I could nap standing up.'],
  social: ['Oh! {name}! Someone to talk to, finally.', 'Hey {name}... got a minute? It’s been a quiet day.', '{name}, hi. I was starting to feel invisible.', 'Hi {name}. Nobody’s said hi to me all day.'],
  fun: ['{name}, save me. I’m so bored.', 'Hey {name}. Know anything fun to do? Anything?', 'Ugh, {name}, this town is so quiet today.', '{name}! Please tell me something exciting.'],
};
const DISTRESS_RESPONSES: Record<'energy' | 'social' | 'fun', Bank> = {
  energy: ['Mm-hm. Tired. Hi.', 'Too sleepy to chat, {name}.', '*yawn* Sorry. Hi, {name}.', 'Hi... five more minutes...'],
  social: ['Oh, {name}! I really needed this.', 'Hi! Wow, someone actually stopped by.', '{name}! Stay a bit?', 'You came to talk to me? Aw, {name}.'],
  fun: ['Hey {name}. Entertain me?', 'Hi {name}. Please tell me something exciting.', 'Oh good, {name}. I was dying of boredom.', 'Anything new, {name}? Anything at all?'],
};
const BICKER_OPENERS: Bank = [
  'Could you be any louder, {name}?', '{name}, you’re in my spot.', 'Oh great. It’s {name}.', 'Must you always be so... much, {name}?',
  'Some of us are trying to relax, {name}.', '{name}, that’s the third time you bumped into me today.', 'Do you ever slow down, {name}?', 'Not you again, {name}.',
];
const BICKER_RETORTS: Bank = [
  'Lighten up, {name}!', 'Wow. Rude.', 'At least I’m having fun, {name}.', 'Somebody skipped their nap.',
  'Says you, {name}.', 'I was here first!', 'Ugh, fine. Whatever.', 'You’re such a grump, {name}.',
];
const BICKER_LAST: Bank = ['Hmph.', 'Unbelievable.', 'Whatever.', 'Fine.', 'Typical.'];
const APOLOGIES: Bank = [
  'Hey {name}... sorry about earlier.', '{name}, I was grumpy before. Truce?', 'I brought a peace offering, {name}. Sorry.', 'Can we start over, {name}?',
  '{name}, I owe you an apology. I was out of line.', 'Still friends, {name}? I’m sorry.',
];
const APOLOGY_YES: Bank = ['Apology accepted. Friends?', 'Aw, it’s okay. I was cranky too.', 'Truce! Cocoa’s on me.', 'Already forgotten, {name}.', 'Deal. No more squabbles.'];
const APOLOGY_NO: Bank = ['...Not yet, {name}.', 'I’ll think about it.', 'Hmph. We’ll see.'];
export const DISTRESS_MUTTERS: Record<'energy' | 'social' | 'fun', Bank> = {
  energy: ['*yawn* I need a nap.', 'So... sleepy...', 'Can’t keep my eyes open.', 'Bed. Now. Please.', 'Who turned up gravity today?'],
  social: ['Is anyone around? ...No? Okay.', 'Nobody’s talked to me all day.', 'I could really use a friend right now.', 'Hello? Anyone want to hang out?', 'Feeling a bit invisible today.'],
  fun: ['So. Bored.', 'There must be something fun to do around here.', 'Ugh, nothing’s happening.', 'I’ve counted every cobblestone. Twice.', 'Entertain me, town!'],
};
const LONELY_REPLIES: Bank = ['Oh! Someone’s talking to me! Hi, {name}!', 'Hi {name}! You made my day just by saying that.', 'Aw, {name}. I needed that.'];
const BORED_REPLIES: Bank = ['Finally, something interesting! Hi, {name}!', 'Ooh, {name}, tell me more. Anything.', 'Yes! Excitement! Thanks, {name}.'];
const TIRED_REPLIES: Bank = ['Mm. *yawn*', 'Too tired for this, {name}.', 'Sure, sure... zzz.', 'Talk tomorrow, {name}?'];
const INTROS: Bank = [
  'Hi! I’m {me}. I don’t think we’ve met!', 'Hello there! {me}, nice to meet you.', 'Hey, are you new around here? I’m {me}!',
  'Hi! I’m {me}, I live over at {home}.', 'Oh, a new face! I’m {me}.', 'Hi there! I’m {me}. And you are...?',
  'Hello! {me} here. Love your style, by the way.', 'Hey! I’ve seen you around. I’m {me}!', 'Hi! I’m {me}. Welcome to the neighborhood, officially.',
  'Hey there, neighbor! The name’s {me}.',
];
const INTROS_BY_TRAIT: Partial<Record<string, Bank>> = {
  grumpy: ['...I’m {me}. You’re new.', 'Name’s {me}. Don’t wear it out.', '{me}. I live here. Obviously.'],
  shy: ['Um, hi... I’m {me}. Nice to meet you.', 'H-hello. I’m {me}. Sorry, I’m bad at this.'],
  playful: ['Hi hi! I’m {me}, local legend. Allegedly.', 'Greetings, traveler! I’m {me}. Ha, kidding. Hi!'],
  chaotic: ['I’m {me}! I’ve lived here for a hundred years. Or a week.'],
  bookish: ['Hello. I’m {me}. I’m usually behind a book.'],
  foodie: ['Hi! I’m {me}. Ask me anything about the café menu.'],
};
const VISITOR_INTROS: Bank = [
  'Hi! I came through the portal with the {channel} raid!', 'Hello! Visiting from {channel}. This town is adorable!', 'Hey! Raid party member, reporting for fun!',
];
const INTRO_REPLIES_POS: Bank = [
  'Hi! I’m {me}. Lovely to meet you, {name}.', 'Nice to meet you, {name}! I’m {me}.', '{name}! I’m {me}. I think we’re going to be friends.',
  'Hey {name}! I’m {me}. Welcome to the neighbor club!', 'So nice to finally meet you, {name}. I’m {me}!', 'Hi {name}! I’m {me}. Want the grand tour sometime?',
  'I’m {me}, and I’ve already decided I like you, {name}.', 'Oh, hi! I’m {me}. Your timing is perfect, {name}.', 'Hey! {me} here. Any friend of the town is a friend of mine.',
  'Hello, {name}! I’m {me}. You’ll love it here.',
];
const INTRO_REPLIES_POS_BY_TRAIT: Partial<Record<string, Bank>> = {
  grumpy: ['{me}. ...Fine. Nice to meet you, {name}.', 'I’m {me}. You seem tolerable, {name}.'],
  shy: ['Oh! I’m {me}. N-nice to meet you, {name}.'],
  playful: ['I’m {me}! Wanna be best friends? Too soon? Okay.'],
};
const INTRO_REPLIES_NEG: Bank = [
  'Mm. {me}. Hi, I guess.', 'I’m {me}. I’m also busy.', '{me}. Can we do this later?', 'Hmph. {me}. Hello.',
  'I’m {me}. Not really a people person right now.', '{me}. Sure. Hi.',
];

const RESPONSES_POS: Bank = [
  'Hey {name}! Great to see you!', 'Oh, hi {name}! You just made my day.', '{name}! I was hoping I’d run into you.',
  'Ha, hi {name}! Always a pleasure.', 'Hiya {name}! Pull up a cobblestone.', 'Hey you! How’s it going, {name}?',
  '{name}! Perfect timing, I was getting bored.', 'Hi {name}! You look great today.', 'Oh hey, {name}! What’s new?',
  '{name}! My favorite person to bump into.', 'Hey {name}! I was just thinking about you.', 'Hi hi, {name}! Come, sit, chat.',
];
const RESPONSES_POS_BY_TRAIT: Partial<Record<string, Bank>> = {
  grumpy: ['Hmph. Fine. Hi, {name}.', '...Okay, that was nice. Hi.', 'You again. ...Good.'],
  shy: ['Oh! H-hi {name}. That’s really nice of you.', 'Hi {name}... you’re kind of my favorite.'],
  playful: ['{name}!! *finger guns*', 'Tag back! Ha, hi {name}!', '{name}! Took you long enough!'],
  chaotic: ['{name}! I was JUST thinking about you. And soup.', 'AAAH {name}! Hi!'],
  kind: ['{name}! It’s so good to see you.', 'Hi {name}! Want half of my cookie?'],
  'night-owl': ['Hey {name}! The fun starts after dark, you know.'],
};
const RESPONSES_NEG: Bank = [
  'Not now, {name}.', 'Ugh, I’m not in the mood, {name}.', 'Can’t a person sulk in peace?', 'Mm. Sure. Whatever.',
  '{name}, I’ve had a day. Later?', 'Hmph. Hi, {name}.', 'Not today, {name}.', 'I’m kind of busy, {name}.',
  'Mm-hm. Sure, {name}.', 'Can it wait, {name}?',
];
const RESPONSES_TIRED: Bank = ['Sorry {name}, I’m running on fumes.', '*yawns* Oh, hi {name}...', 'Five more minutes, {name}...'];

interface TopicDef { id: string; label: string; lines: Bank; replies: Bank; joke?: boolean }

const WEATHER_TOPICS: Record<Weather, TopicDef> = {
  rain: { id: 'rain', label: 'the rain', lines: ['This rain! My socks are soup.', 'Rain means cocoa weather. No arguments.', 'I love how the plaza sparkles in the rain.'], replies: ['Cocoa sounds perfect.', 'Puddle-jumping later?', 'Ha! Same, honestly.'] },
  snow: { id: 'snow', label: 'the snow', lines: ['Snowball fight at the plaza later?', 'Everything looks like frosting!', 'I caught a snowflake on my tongue. Tastes like winter.'], replies: ['You’re on!', 'It’s so pretty.', 'Brrr, but worth it.'] },
  sunset: { id: 'sunset', label: 'the sunset', lines: ['Look at that sky. Pure orange sherbet.', 'Sunsets here hit different.', 'The fountain turns gold at sunset, did you notice?'], replies: ['Wow. Yeah.', 'I could watch this forever.', 'Golden hour, golden friends.'] },
  sunny: { id: 'sunny', label: 'the sunshine', lines: ['This sunshine is unreal.', 'Not a single cloud today!', 'Perfect weather for doing absolutely nothing.'], replies: ['Peak vibes.', 'I’m soaking it all in.', 'Agreed. Ten out of ten.'] },
};
const TIME_TOPICS: Record<WorldClock['period'], TopicDef> = {
  morning: { id: 'morning', label: 'mornings', lines: ['Mornings are better with company.', 'I’ve already had two lattes. Maybe three.', 'The birds were singing my song this morning.'], replies: ['Truly.', 'Three? Respect.', 'Which song?!'] },
  afternoon: { id: 'afternoon', label: 'the afternoon', lines: ['Afternoons were made for snacks.', 'Is it just me, or is today flying by?'], replies: ['Snacks are a lifestyle.', 'Time flies in this town.'] },
  evening: { id: 'evening', label: 'the evening', lines: ['The lamps make everything feel cozy.', 'Evenings here feel like a movie.'], replies: ['So cozy.', 'Roll credits!'] },
  night: { id: 'night', label: 'the stars', lines: ['Have you seen how bright the stars are?', 'The town sounds different at night. Softer.', 'I think the moon is following me.'], replies: ['It’s my favorite time.', 'Let’s stay out a little longer.', 'It does that.'] },
};
const PLACE_TOPICS: Partial<Record<PoiDef['kind'], TopicDef>> = {
  cafe: { id: 'cafe', label: 'pastries', lines: ['The {drink} here is dangerously good.', 'I’ve rated every pastry here. Cinnamon bun: eleven out of ten.'], replies: ['Don’t let me order another one.', 'Strong agree.'] },
  'cafe-seat': undefined,
  arcade: { id: 'arcade', label: 'high scores', lines: ['I’m one level away from the high score.', 'The claw machine owes me three plushies.'], replies: ['You have got this!', 'That machine is rigged. I’m sure of it.'] },
  park: { id: 'park', label: 'the ducks', lines: ['The ducks in the pond have opinions today.', 'Willow Park is the best place to think.'], replies: ['They always do.', 'It really is.'] },
  stage: { id: 'stage', label: 'the music', lines: ['That beat is stuck in my head.', 'Who’s performing tonight?'], replies: ['Same! Bop bop.', 'Hopefully us!'] },
  garden: { id: 'garden', label: 'the garden', lines: ['The tomatoes are finally coming in!', 'I planted sunflowers. They’re taller than me now.'], replies: ['Save me one!', 'Garden goals.'] },
  fountain: { id: 'fountain', label: 'wishes', lines: ['I made a wish at the fountain. Can’t tell you what.', 'Every coin in that fountain is a tiny dream.'], replies: ['Ooh, mysterious.', 'That’s beautiful.'] },
  plaza: { id: 'plaza', label: 'town gossip', lines: ['The plaza is buzzing today.', 'I love people-watching here.'], replies: ['Best spot in town.', 'Same, it’s like free TV.'] },
  portal: { id: 'portal', label: 'the portal', lines: ['I swear the portal winked at me.', 'Every time it glows, someone new shows up.'], replies: ['Spooky.', 'I love meeting new people.'] },
  playground: { id: 'playground', label: 'the swings', lines: ['The swings are criminally underrated.', 'I went down the slide twice. No regrets.'], replies: ['Swing gang!', 'Only twice?'] },
  bench: { id: 'bench', label: 'benches', lines: ['This bench has seen things.', 'Best seat in the house, honestly.'], replies: ['Ha! True.', 'Front row seats.'] },
  home: { id: 'home', label: 'home', lines: ['Home sweet home.', 'I just repainted my front door.'], replies: ['Cozy!', 'It looks great!'] },
};
const NEED_TOPICS = {
  energy: { id: 'tired', label: 'naps', lines: ['I could nap for a week.', 'Is it too early for a nap? Asking for me.'], replies: ['Bench nap. Do it.', 'Never too early.'] } as TopicDef,
  fun: { id: 'bored', label: 'boredom', lines: ['I need something fun to do. Ideas?', 'I’m so bored I counted the cobblestones. 812.'], replies: ['Arcade. Now.', 'Dance stage? Dance stage.'], joke: true } as TopicDef,
  social: { id: 'lonely', label: 'missing people', lines: ['Honestly, I missed talking to people.', 'It’s nice to just chat, you know?'], replies: ['Me too. Let’s do this more.', 'Anytime.'] } as TopicDef,
};
const TRAIT_TOPICS: Partial<Record<string, TopicDef>> = {
  bookish: { id: 'books', label: 'books', lines: ['I’m reading about a lighthouse keeper. Riveting stuff.', 'Books are just snacks for your brain.'], replies: ['Lend it to me after?', 'Very wise.'] },
  foodie: { id: 'food', label: 'food', lines: ['I’ve decided pancakes count as a personality.', 'The secret ingredient at the café is love. And butter.'], replies: ['Valid.', 'Mostly butter.'], joke: true },
  competitive: { id: 'rivalry', label: 'the arcade rivalry', lines: ['Bet I can beat your arcade score.', 'I’ve been practicing my high-score face.'], replies: ['Bring it on!', 'We’ll see about that.'] },
  creative: { id: 'art', label: 'dance moves', lines: ['I’m working on a new dance move. It’s called The Fountain.', 'I want to paint the plaza at sunset.'], replies: ['Show me!', 'That would be gorgeous.'] },
  playful: { id: 'games', label: 'games', lines: ['Let’s start a conga line. Right now.', 'I hid a rubber duck somewhere in town. Good luck.'], replies: ['Count me in!', 'Oh no. Oh yes.'], joke: true },
  curious: { id: 'mysteries', label: 'town mysteries', lines: ['Ever notice the portal glows brighter when people arrive?', 'I mapped every shortcut in town. There are four.'], replies: ['Now that you mention it...', 'Show me sometime!'] },
  'night-owl': { id: 'nightlife', label: 'staying up late', lines: ['Night is when this town really wakes up.', 'Sleep is a suggestion.'], replies: ['Night owls unite.', 'Legally, I can’t agree. But yes.'], joke: true },
  kind: { id: 'kindness', label: 'cookies', lines: ['If you ever need anything, just shout.', 'I left cookies on the bench for whoever needs one.'], replies: ['You’re the best.', 'That’s so sweet.'] },
  chaotic: { id: 'chaos', label: 'dancing ducks', lines: ['I tried to teach the ducks to dance. Results: mixed.', 'What if the fountain was soup? Just asking.'], replies: ['...Mixed how?', 'Please do not.'], joke: true },
  romantic: { id: 'romance', label: 'the stars', lines: ['Do you think the stars are jealous of the lamps?', 'Love is in the air. Also pollen.'], replies: ['Smooth.', 'Achoo! I mean, aww.'], joke: true },
  energetic: { id: 'energy', label: 'jogging', lines: ['I’ve done three laps of the plaza already!', 'Want to go for a jog? Or a sprint? Or both?'], replies: ['How?!', 'Maybe after a nap.'] },
  lazy: { id: 'lazy', label: 'comfy benches', lines: ['I found the comfiest bench in town. Not telling.', 'Walking is just falling, but slower.'], replies: ['Tell meee.', 'Deep.'], joke: true },
  grumpy: { id: 'grumbles', label: 'the pigeons', lines: ['The pigeons are plotting something.', 'Too much noise today. Too much... cheer.'], replies: ['You love it secretly.', 'They’re definitely plotting.'], joke: true },
  shy: { id: 'poems', label: 'poetry', lines: ['I wrote a little poem today. Maybe I’ll share it someday.', 'Crowds are a lot. This is nice, though.'], replies: ['I’d love to hear it.', 'This is nice.'] },
  friendly: { id: 'neighbors', label: 'the neighbors', lines: ['I think I’ve met everyone in town now. Twice.', 'This neighborhood has the best people.'], replies: ['You’re the town welcome committee.', 'Including you!'] },
};
const RAID_TOPIC: TopicDef = { id: 'raid', label: 'the raid', lines: ['Did you see the raiders come through the portal? So many new faces!', 'That raid from {channel} was amazing!'], replies: ['Best day ever.', 'I already made three new friends.'] };
const CONFETTI_TOPIC: TopicDef = { id: 'confetti', label: 'the confetti', lines: ['Who keeps launching confetti? I love them.', 'There’s confetti in my hair. Worth it.'], replies: ['Confetti is a lifestyle.', 'Keep it!'], joke: true };
const NEWCOMER_TOPIC: TopicDef = { id: 'newcomer', label: 'the new neighbor', lines: ['Have you met {newcomer} yet? They just moved in.', 'There’s a new face in town: {newcomer}!'], replies: ['Not yet! Let’s say hi.', 'The more the merrier.'] };
/** Only within ~an hour of the arrival (and while they are still in town). */
const ARRIVAL_TOPIC: TopicDef = { id: 'arrival', label: 'the new neighbor', lines: ['{newcomer} just arrived through the portal!', 'Did you see {newcomer} come through the portal?'], replies: ['Not yet! Let’s say hi.', 'The more the merrier.'] };
/** Only while {dancer} is dancing ON the Dance Stage right now (re-checked when spoken). */
const STAGE_DANCER_TOPIC: TopicDef = { id: 'dancer', label: 'the dance stage', lines: ['{dancer} is tearing up the stage!', 'Look at {dancer} go on the Dance Stage!'], replies: ['Those moves!', 'We should join!'] };
/** Only while {dancer} is dancing somewhere right now (re-checked when spoken). */
const DANCER_TOPIC: TopicDef = { id: 'dancer-any', label: 'dance moves', lines: ['Have you seen {dancer} dance? Wow.', '{dancer} is dancing again! Love the energy.'], replies: ['Those moves!', 'We should join!'] };
const MEMORY_TAILS: Bank = ['Good times.', 'Still makes me smile.', 'Classic us.', 'Never forget.', 'We should do that again.'];
const MEMORY_REPLIES: Bank = ['How could I forget!', 'Ha! Legendary.', 'Best day.', 'You still owe me for that one.'];

export const DRINKS_HOT = ['cocoa', 'a latte', 'chai', 'hot cider', 'a cappuccino'] as const;
export const DRINKS_COLD = ['iced tea', 'lemonade', 'an iced latte', 'a berry smoothie'] as const;
export const FOODS = ['a cinnamon bun', 'a croissant', 'berry pie', 'a bagel', 'pancakes', 'a waffle'] as const;
export const GAMES = ['Star Blaster', 'Pixel Kart', 'the claw machine', 'Dance Dash', 'pinball'] as const;
export const BOOKS = ['a mystery novel', 'poetry', 'a comic book', 'a travel guide', 'a fantasy saga'] as const;
export const PLAYGROUND_TOYS = ['the swings', 'the slide', 'the seesaw', 'the climbing frame'] as const;
export const GIFT_ITEMS = ['flowers', 'a cookie', 'a seashell', 'a tiny cactus', 'a mixtape', 'a lucky coin', 'a friendship bracelet', 'a cinnamon bun'] as const;

const COMPLIMENTS: Bank = [
  '{name}, that {thing} is iconic!', 'Okay {name}, I love your {thing}.', '{name}, your {thing} makes my day every time.',
  'Is it just me, or does {name} have the best {thing} in town?', '{name}! Your {thing} is a whole mood.',
];
const COMPLIMENTS_BY_TRAIT: Partial<Record<string, Bank>> = {
  grumpy: ['{name}. Your {thing}... is acceptable. That’s high praise.'],
  romantic: ['{name}, your {thing} could stop traffic. If we had traffic.', '{name}, you and that {thing}? Poetry.'],
  shy: ['Um, {name}? I really like your {thing}.'],
  chaotic: ['{name}, if your {thing} were a sandwich, I’d eat it. Compliment!'],
};
const COMPLIMENT_REPLIES_POS: Bank = ['Aww, thank you, {name}!', 'Stop it, you’re making me blush!', 'Thank you! I picked it out myself.', '{name}, you’re too sweet.'];
const COMPLIMENT_REPLIES_POS_BY_TRAIT: Partial<Record<string, Bank>> = {
  grumpy: ['...Thanks. I guess.', 'Hmph. Well. You’re not wrong.'],
  shy: ['O-oh! Thank you, {name}...'],
  playful: ['I know, right?! Thanks, {name}!'],
};
const COMPLIMENT_REPLIES_NEG: Bank = ['Uh-huh. Sure.', 'Flattery will not work on me, {name}.', 'Okay, what do you want?'];

const GIFT_LINES: Bank = ['I brought you {item}, {name}!', '{name}! I saw {item} and thought of you.', 'A little something for you, {name}: {item}!'];
const THANKS_POS: Bank = ['{Item}? For me? {name}, you should not have!', 'Aww, {name}! I love it!', 'You remembered! Thank you, {name}!', 'This is perfect. Thank you, {name}!'];
const THANKS_BY_TRAIT: Partial<Record<string, Bank>> = {
  grumpy: ['Hmph. ...I’ll treasure it. Don’t tell anyone.', 'For me? ...Thanks, {name}.'],
  shy: ['Oh! Th-thank you so much, {name}...'],
  foodie: ['{Item}! You know me so well, {name}.'],
  chaotic: ['{Item}?! I’m going to name it Gerald. Thank you, {name}!'],
};
const THANKS_WOKEN: Bank = ['Wha-? Oh! {Item}! Thank you, {name}!', '*yawn* Is that for me? Aww, {name}.'];

const BEFRIEND_ASK: Bank = ['{name}, we’re friends now, right? Official?', 'Friends? Friends!', 'I think you’re officially my friend, {name}.'];
const BEFRIEND_YES: Bank = ['Officially official!', 'Absolutely, {name}!', 'Took you long enough! Yes!', 'Best friends! Pinky promise, {name}.'];
const BEFRIEND_YES_BY_TRAIT: Partial<Record<string, Bank>> = { grumpy: ['Fine. Friends. Don’t make it weird.'], shy: ['R-really? Yes! Friends, {name}.'] };
const BEFRIEND_NO: Bank = ['Let’s hang out a bit more first, {name}!', 'Maybe! Ask me again after cocoa.', 'Slow down, {name}. We just met!'];

const WELCOMES: Bank = [
  'Welcome to the neighborhood, {name}!', 'Hey {name}! Welcome to town. The café is that way!', 'A new face! Welcome, {name}!',
  'Welcome, {name}! You picked a great day to move in.', 'Hi {name}! Welcome! You’re going to love it here.', 'Welcome, welcome, {name}! Make yourself at home.',
  '{name}! Welcome! Ask me anything, I know every shortcut.', 'Oh, hello {name}! Welcome to the friendliest town around.', 'Welcome, {name}! The stage gets lively at night.',
  'Hey, welcome {name}! Want me to show you the fountain?',
];
const WELCOMES_BY_TRAIT: Partial<Record<string, Bank>> = {
  grumpy: ['Another one. ...Welcome, {name}.', 'Hmph. Welcome, {name}. Wipe your feet.'],
  foodie: ['Welcome, {name}! First stop: Sunbeam Café. Trust me.'],
  playful: ['Welcome, {name}! You’re it! Kidding. Welcome!'],
};
const NEWCOMER_HELLO: Bank = [
  'Hi everyone! I’m {me}!', 'Hello, neighborhood!', 'Wow, this place is even cuter in person!', 'Hi! Just moved in. I’m {me}!',
  'Hey hey! {me} has arrived!', 'Hello! Is this where the fun is?', 'Hi all! Where’s the café everyone talks about?', 'Hiya! New neighbor here!',
];
const REJOIN_HELLO: Bank = ['I’m back, everyone!', 'Hello again, neighborhood!', 'Did you miss me?'];
const NEW_LOOK: Bank = ['New look, who dis?', 'Fresh fit! What do you think?', 'Feeling brand new today!', 'Do you like it? I just changed my whole look!', 'Mirror, mirror... nailed it.'];
const LOOK_COMPLIMENTS: Bank = ['Ooh, {name}! Love the new look!', '{name}?! Barely recognized you. Gorgeous!', 'Okay {name}, that style is a whole upgrade.', 'New look suits you, {name}!'];
const SNUBS: Bank = ['Hmph.', 'Not now.', '*pretends not to see*', 'Mm.'];

const CHAT_REPLIES: Record<string, Bank> = {
  greeting: ['Hey {name}! Welcome back!', 'Hi {name}! Good to see you!', 'Oh hey, {name}!', 'Hiya {name}!'],
  question: ['Good question, {name}. Ask me again after cocoa.', 'Hmm, let me think about that one, {name}.', 'I asked the fountain. It said maybe.'],
  love: ['Aww, love you too, {name}!', 'Right back at you, {name}!'],
  laugh: ['Haha, {name}, you’re hilarious.', 'Ha! Good one, {name}.'],
  hype: ['Let’s gooo!', 'The hype is real, {name}!', 'Pog indeed!'],
  dance: ['Did someone say dance?!', 'To the stage!'],
  food: ['Sunbeam Café has your back, {name}.', 'Now I’m hungry. Thanks, {name}.'],
  bye: ['Bye {name}! Come back soon!', 'Night, {name}! See you tomorrow.'],
  generic: ['Ha, true!', 'You said it, {name}!', 'Love that energy, {name}.', 'Agreed!', 'Wise words, {name}.', 'Couldn’t have said it better, {name}.'],
  grumpy: ['Hmph. If you say so, {name}.', 'Sure, {name}. Sure.'],
  negative: ['Not now, {name}.', 'Mm.', 'Can we not?'],
};
const CHAT_PATTERNS: Array<[RegExp, string]> = [
  [/\b(hi|hello|hey|hiya|yo|sup|howdy|morning|evening)\b/i, 'greeting'],
  [/\b(bye|goodnight|gn|later|cya)\b/i, 'bye'],
  [/\b(love|<3|heart)\b/i, 'love'],
  [/\b(lol|lmao|haha+|lul|kekw|xd|rofl)\b/i, 'laugh'],
  [/\b(pog|poggers|hype|gg|lets go|let's go|wow|omg)\b/i, 'hype'],
  [/\b(dance|music|song|party)\b/i, 'dance'],
  [/\b(food|coffee|cocoa|tea|pizza|cake|hungry|snack|cookie)\b/i, 'food'],
  [/\?\s*$/, 'question'],
];

const WEATHER_LINES: Record<Weather, Bank> = {
  rain: ['Rain! Last one to the café buys cocoa!', 'Umbrellas up, everyone!', 'Ooh, rain! Puddle season!'],
  snow: ['SNOW! Everybody outside!', 'Is that... snow? Snowball fight!', 'It’s snowing! The plaza looks like a cake.'],
  sunset: ['Look at the sky! Everyone, look!', 'Golden hour! Quick, to the fountain!', 'That sunset is showing off.'],
  sunny: ['The sun’s back! Hello, sunshine!', 'Sunshine! Finally!', 'What a gorgeous day!'],
};
const RAID_ANNOUNCE: Bank = ['A raid! Everyone to the portal!', 'Raiders incoming! Get the confetti!', 'The portal is glowing! We have visitors!'];
const RAID_ARRIVAL: Bank = ['Hello, neighborhood! {channel} sent us!', 'We come in peace! And with snacks!', 'Raid party has arrived!'];
const RAID_WELCOME: Bank = ['Welcome, raiders! Make yourselves at home!', 'Welcome to HELLO WORLD, friends!', 'So many new faces! Welcome!'];
const RAID_FAREWELL: Bank = ['Thanks for having us! Bye, neighborhood!', 'Best town ever. We’ll be back!', 'Raid party, out! See you soon!'];
const CONFETTI_LINES: Bank = ['Confetti! Who’s celebrating?', 'Woohoo! Party time!', 'There’s confetti in my hair. Worth it.'];
const DANCE_JOIN: Bank = ['Ooh, I love this song!', 'Dance party? Count me in!', 'Wait for me, {name}!', 'Move over, {name}, I’ve moves too!'];
const DANCE_GRUMBLE: Bank = ['Some of us are trying to relax here.', 'Must you dance right now, {name}?', 'Hmph. Show-off.'];
const CELEBRATE_REPLIES: Bank = ['Woo! Go {name}!', 'Celebrate good times!', 'Yay, {name}!'];
// Night routine (behavior/night.ts): heading to bed, can't sleep, waking up.
const GOODNIGHT_LINES: Bank = [
  'Night, everyone! See you at breakfast.', 'That’s me done for today. Goodnight, town!', '*yawn* Bedtime. Sweet dreams, all.',
  'Off to bed before I fall asleep standing up.', 'Goodnight! Save me a croissant tomorrow.', 'Lights out for me. Night night!',
  'My pillow is calling my name. Goodnight!', 'Big day tomorrow. Night, everyone!', 'Heading home to {home}. Sleep well!',
];
const GOODNIGHT_BY_TRAIT: Partial<Record<string, Bank>> = {
  grumpy: ['Finally. Peace and quiet. Goodnight.', 'Don’t wake me before noon.'],
  lazy: ['Bed. Glorious bed.', 'I’ve been looking forward to this all day.'],
  bookish: ['One more chapter in bed, then lights out.'],
  energetic: ['Going to bed so I can be up at dawn!'],
  romantic: ['Goodnight, moon. Goodnight, town.'],
};
const RESTLESS_LINES: Bank = [
  'Can’t sleep... maybe some fresh air will help.', 'Too awake to sleep. Stargazing it is.', 'Is anyone else up? The town is so quiet.',
  'Counting sheep isn’t working. Time for a little walk.', 'A midnight cocoa sounds perfect right now.', 'Couldn’t sleep — the stars are too pretty tonight.',
  'Shh... everyone’s asleep. Just me and the moon.', 'Wide awake. Might as well enjoy the quiet.',
];
const MORNING_LINES: Bank = [
  'Good morning, everyone!', 'Morning! Who’s up for breakfast at Sunbeam Café?', 'What a lovely morning.', 'Rise and shine, neighbors!',
  'Morning! I slept like a log.', 'Coffee first. Then words.', 'Morning, town! It smells like fresh bread out here.', 'Ahh, what a sunrise. Morning, all!',
];
const MORNING_BY_TRAIT: Partial<Record<string, Bank>> = {
  grumpy: ['Too early. Way too early.', 'Morning. Don’t talk to me yet.'],
  lazy: ['Five more minutes would’ve been nice...', '*yawn* Is it really morning already?'],
  energetic: ['Up and at ’em! Who wants to race to the fountain?', 'Best sleep ever. Let’s GO!'],
  foodie: ['I dreamt about pancakes. Café, here I come!'],
  'night-owl': ['Morning? Already? Ugh, fine.'],
};
const BEFRIEND_MILESTONE: Bank = ['{name}, I think we’re officially friends now!', 'Friends? Friends. Definitely friends, {name}.', 'You know what, {name}? You’re one of my favorite people.'];

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------
export interface Topic {
  id: string; label: string; line: string; reply: string; joke: boolean;
  /** Present for topics that claim something about the world right now (who is dancing where, who just arrived). */
  check?: (w: World) => boolean;
}

const STAGE = POIS.find(p => p.kind === 'stage');
/** Dancing right now (a perform-phase dance, not walking over to one). */
export function dancingNow(a: Agent | undefined): boolean {
  return !!a && !a.leaving && a.action?.phase === 'perform' && (a.action.type === 'dance' || a.activity.startsWith('dancing'));
}
/** Dancing on (or right at the edge of) the Dance Stage right now. */
export function dancingOnStage(a: Agent | undefined): boolean {
  return dancingNow(a) && !!STAGE && Math.hypot(a!.x - STAGE.position.x, a!.z - STAGE.position.z) <= STAGE.radius + 1.5;
}

/** A topic that is always true (the weather or the time of day) — the stand-in when a planned topic went stale. */
export function fallbackTopic(w: World, speaker: Agent, vars: Vars): Topic {
  const clock = worldClock(w.simTime);
  const t = w.weather !== 'sunny' || hasFresh(w, `topic:${WEATHER_TOPICS[w.weather].id}`, WEATHER_TOPICS[w.weather].lines) ? WEATHER_TOPICS[w.weather] : TIME_TOPICS[clock.period];
  return heTopic(t, w, speaker, vars);
}

export interface TopicContext {
  w: World;
  speaker: Agent;
  listener: Agent;
  place: PoiDef;
  friendship: number;
  memories: readonly string[];
  vars: Vars;
}

function heTopic(t: TopicDef, w: World, s: Agent, vars: Vars): Topic {
  return {
    id: t.id, label: t.label, joke: !!t.joke,
    line: fill(choose(w, `topic:${t.id}`, t.lines, s.id), vars),
    reply: fill(chooseFrom(w, [[`reply:${t.id}`, t.replies], ['reply:any', AGREE]], s.id), vars),
  };
}

/** Weighted topic choice: memories (high friendship), happenings, weather, place, needs, hobbies, time. */
export function pickTopic(ctx: TopicContext): Topic {
  const { w, speaker, listener, place, friendship, memories, vars } = ctx;
  const clock = worldClock(w.simTime);
  const cands: Array<{ w: number; make: () => Topic | null }> = [];
  const fresh = (t: TopicDef, weight: number) => (hasFresh(w, `topic:${t.id}`, t.lines) ? weight : 0);
  if (friendship >= 55 && memories.length) {
    // Inside jokes grow with friendship.
    cands.push({ w: 1.4 + (friendship - 55) / 12, make: () => {
      const cb = memoryCallback(w, speaker, listener, memories);
      return cb ? { id: 'memory', label: 'old times', line: cb, reply: fill(choose(w, 'reply:memory', MEMORY_REPLIES, listener.id), vars), joke: false } : null;
    } });
  }
  if (w.simTime - w.facts.raidAt < 200 && w.facts.raidChannel) cands.push({ w: fresh(RAID_TOPIC, 1.6), make: () => heTopic(RAID_TOPIC, w, speaker, vars) });
  if (w.simTime - w.facts.confettiAt < 90) cands.push({ w: fresh(CONFETTI_TOPIC, 1.2), make: () => heTopic(CONFETTI_TOPIC, w, speaker, vars) });
  // Grounded happenings: only about people who are still here and doing it right now (re-checked when spoken).
  const nc = w.facts.newcomer;
  const ncAgent = nc ? (nc.id ? w.agents.get(nc.id) : [...w.agents.values()].find(o => o.displayName === nc.name)) : undefined;
  if (nc && ncAgent && !ncAgent.leaving && w.simTime - nc.at < 240 && ncAgent !== speaker && ncAgent !== listener) {
    const id = ncAgent.id;
    const here = (w2: World) => { const o = w2.agents.get(id); return !!o && !o.leaving; };
    const t = w.simTime - nc.at < 60 ? ARRIVAL_TOPIC : NEWCOMER_TOPIC;
    cands.push({ w: fresh(t, 1.2), make: () => ({ ...heTopic(t, w, speaker, { ...vars, newcomer: ncAgent.displayName }), check: here }) });
  }
  let onStage: Agent | undefined, elsewhere: Agent | undefined;
  for (const o of w.agents.values()) {
    if (o === speaker || o === listener || !dancingNow(o)) continue;
    if (!onStage && dancingOnStage(o)) onStage = o;
    else elsewhere ??= o;
  }
  if (onStage) {
    const id = onStage.id, name = onStage.displayName;
    cands.push({ w: fresh(STAGE_DANCER_TOPIC, 0.9), make: () => ({ ...heTopic(STAGE_DANCER_TOPIC, w, speaker, { ...vars, dancer: name }), check: w2 => dancingOnStage(w2.agents.get(id)) }) });
  } else if (elsewhere) {
    const id = elsewhere.id, name = elsewhere.displayName;
    cands.push({ w: fresh(DANCER_TOPIC, 0.7), make: () => ({ ...heTopic(DANCER_TOPIC, w, speaker, { ...vars, dancer: name }), check: w2 => dancingNow(w2.agents.get(id)) }) });
  }
  cands.push({ w: fresh(WEATHER_TOPICS[w.weather], w.weather === 'sunny' ? 0.55 : 1.4), make: () => heTopic(WEATHER_TOPICS[w.weather], w, speaker, vars) });
  const pt = PLACE_TOPICS[place.kind];
  if (pt) cands.push({ w: fresh(pt, 0.9), make: () => heTopic(pt, w, speaker, vars) });
  const needs = speaker.needs;
  if (needs.energy < 30) cands.push({ w: fresh(NEED_TOPICS.energy, needs.energy < 25 ? 4 : 1.1), make: () => heTopic(NEED_TOPICS.energy, w, speaker, vars) });
  if (needs.fun < 30) cands.push({ w: fresh(NEED_TOPICS.fun, needs.fun < 25 ? 4 : 1), make: () => heTopic(NEED_TOPICS.fun, w, speaker, vars) });
  if (needs.social < 25) cands.push({ w: fresh(NEED_TOPICS.social, 4), make: () => heTopic(NEED_TOPICS.social, w, speaker, vars) });
  for (const trait of speaker.personality) {
    const t = TRAIT_TOPICS[trait];
    if (t) cands.push({ w: fresh(t, 0.8), make: () => heTopic(t, w, speaker, vars) });
  }
  cands.push({ w: fresh(TIME_TOPICS[clock.period], 0.6), make: () => heTopic(TIME_TOPICS[clock.period], w, speaker, vars) });
  let total = 0;
  for (const c of cands) total += c.w;
  if (total <= 0) return heTopic(TIME_TOPICS[clock.period], w, speaker, vars);
  let r = w.rng.float('topic', speaker.id) * total;
  for (const c of cands) {
    r -= c.w;
    if (r <= 0) { const t = c.make(); if (t) return t; break; }
  }
  return heTopic(WEATHER_TOPICS[w.weather], w, speaker, vars);
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** "Kiki beat Rex's high score at Pixel Arcade" → (Rex → Kiki) "you beat my high score at Pixel Arcade". */
export function personalize(clause: string, me: string, you: string): string {
  const M = esc(me), Y = esc(you);
  const B = '(?<![\\w])', E = '(?![\\w])';
  let s = clause;
  s = s.replace(new RegExp(`${B}(${M} and ${Y}|${Y} and ${M})${E}`, 'g'), 'we');
  s = s.replace(new RegExp(`${B}${M}'s${E}`, 'g'), 'my');
  s = s.replace(new RegExp(`${B}${Y}'s${E}`, 'g'), 'your');
  s = s.replace(new RegExp(`^${M}${E}`), 'I');
  s = s.replace(new RegExp(`${B}${M}${E}`, 'g'), 'me');
  s = s.replace(new RegExp(`${B}${Y}${E}`, 'g'), 'you');
  return s;
}

/** "Day 2 09:14 · X did Y at Z — tail." or "Yesterday · 18:20 · X did Y — tail." → "X did Y at Z". */
export function memoryClause(memory: string): string {
  const cut = memory.indexOf(' — ');
  const head = cut >= 0 ? memory.slice(0, cut) : memory;
  const dot = head.lastIndexOf(' · ');
  return (dot >= 0 ? head.slice(dot + 3) : head).replace(/[.!]+$/, '').trim();
}

export function memoryCallback(w: World, speaker: Agent, listener: Agent, memories: readonly string[]): string | null {
  const usable = memories.map(memoryClause).filter(c => c.includes(speaker.displayName) && c.includes(listener.displayName));
  if (!usable.length) return null;
  const clause = usable[w.rng.int(Math.min(4, usable.length), 'memory', speaker.id) + Math.max(0, usable.length - 4)]!;
  const text = personalize(clause, speaker.displayName, listener.displayName);
  return `Remember when ${text}? ${choose(w, 'memory-tail', MEMORY_TAILS, speaker.id)}`;
}

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const bare = (item: string) => item.replace(/^(a|an|the|some)\s+/i, '');
export function withArticle(item: string): string {
  const t = item.trim();
  if (!t) return 'flowers';
  if (/^(a|an|the|some|my|your)\s/i.test(t) || /s$/i.test(t) || /^\d/.test(t)) return t;
  return /^[aeiou]/i.test(t) ? `an ${t}` : `a ${t}`;
}

export function placeVars(w: World, speaker: Agent, listener: Agent | null, at: string, extra: Vars = {}): Vars {
  const hot = w.weather === 'rain' || w.weather === 'snow' || worldClock(w.simTime).period === 'night';
  return {
    name: listener ? first(listener.displayName) : 'everyone', me: speaker.displayName, at,
    drink: bare(w.rng.pick(hot ? DRINKS_HOT : DRINKS_COLD, 'drink', speaker.id)), channel: w.facts.raidChannel || 'a friend', ...extra,
  };
}

export const lines = {
  opener(w: World, s: Agent, vars: Vars): string {
    const d = distressNeed(s, worldClock(w.simTime).period === 'night');
    if (d && w.rng.chance(0.85, 'distress-open', s.id)) return fill(chooseFrom(w, [[`open-distress:${d}`, DISTRESS_OPENERS[d]], ['open:any', OPENERS_ANY]], s.id), vars);
    const period = worldClock(w.simTime).period;
    return fill(flavored(w, s, `open:${period}`, OPENERS[period], OPENERS_BY_TRAIT, 0.45, ['open:any', OPENERS_ANY]), vars);
  },
  intro(w: World, s: Agent, vars: Vars): string { return fill(s.visitor ? choose(w, 'intro-visitor', VISITOR_INTROS, s.id) : flavored(w, s, 'intro', INTROS, INTROS_BY_TRAIT, 0.5), vars); },
  introReply(w: World, s: Agent, positive: boolean, vars: Vars): string {
    return fill(positive ? flavored(w, s, 'intro-pos', INTRO_REPLIES_POS, INTRO_REPLIES_POS_BY_TRAIT, 0.4) : choose(w, 'intro-neg', INTRO_REPLIES_NEG, s.id), vars);
  },
  response(w: World, s: Agent, positive: boolean, vars: Vars): string {
    if (!positive) return fill(s.needs.energy < 20 ? choose(w, 'resp-tired', RESPONSES_TIRED, s.id) : choose(w, 'resp-neg', RESPONSES_NEG, s.id), vars);
    const d = distressNeed(s, worldClock(w.simTime).period === 'night');
    if (d && w.rng.chance(0.85, 'distress-resp', s.id)) return fill(chooseFrom(w, [[`resp-distress:${d}`, DISTRESS_RESPONSES[d]], ['resp-any', RESPONSES_ANY]], s.id), vars);
    return fill(flavored(w, s, 'resp-pos', RESPONSES_POS, RESPONSES_POS_BY_TRAIT, 0.5, ['resp-any', RESPONSES_ANY]), vars);
  },
  compliment(w: World, s: Agent, vars: Vars): string { return fill(flavored(w, s, 'compliment', COMPLIMENTS, COMPLIMENTS_BY_TRAIT, 0.45), vars); },
  complimentReply(w: World, s: Agent, positive: boolean, vars: Vars): string {
    if (!positive) return fill(choose(w, 'compliment-neg', COMPLIMENT_REPLIES_NEG, s.id), vars);
    return fill(flavored(w, s, 'compliment-pos', COMPLIMENT_REPLIES_POS, COMPLIMENT_REPLIES_POS_BY_TRAIT, 0.5), vars);
  },
  gift(w: World, s: Agent, vars: Vars): string { return fill(choose(w, 'gift', GIFT_LINES, s.id), vars); },
  thanks(w: World, s: Agent, woken: boolean, vars: Vars): string {
    const v = { ...vars, Item: cap(vars.item ?? 'this') };
    return fill(woken ? choose(w, 'thanks-woken', THANKS_WOKEN, s.id) : flavored(w, s, 'thanks', THANKS_POS, THANKS_BY_TRAIT, 0.5), v);
  },
  befriendAsk(w: World, s: Agent, vars: Vars): string { return fill(choose(w, 'befriend-ask', BEFRIEND_ASK, s.id), vars); },
  befriendReply(w: World, s: Agent, yes: boolean, vars: Vars): string {
    return fill(yes ? flavored(w, s, 'befriend-yes', BEFRIEND_YES, BEFRIEND_YES_BY_TRAIT, 0.6) : choose(w, 'befriend-no', BEFRIEND_NO, s.id), vars);
  },
  milestone(w: World, s: Agent, vars: Vars): string { return fill(choose(w, 'milestone', BEFRIEND_MILESTONE, s.id), vars); },
  welcome(w: World, s: Agent, vars: Vars): string { return fill(flavored(w, s, 'welcome', WELCOMES, WELCOMES_BY_TRAIT, 0.5), vars); },
  newcomerHello(w: World, s: Agent, rejoin: boolean, vars: Vars): string {
    return fill(rejoin ? choose(w, 'rejoin', REJOIN_HELLO, s.id) : choose(w, 'newcomer', NEWCOMER_HELLO, s.id), vars);
  },
  newLook(w: World, s: Agent, vars: Vars): string { return fill(choose(w, 'new-look', NEW_LOOK, s.id), vars); },
  lookCompliment(w: World, s: Agent, vars: Vars): string { return fill(choose(w, 'look-compliment', LOOK_COMPLIMENTS, s.id), vars); },
  snub(w: World, s: Agent, vars: Vars): string { return fill(choose(w, 'snub', SNUBS, s.id), vars); },
  chatReply(w: World, s: Agent, heard: string, positive: boolean, vars: Vars): string {
    if (!positive) return fill(choose(w, 'chat-neg', CHAT_REPLIES.negative!, s.id), vars);
    const d = distressNeed(s, worldClock(w.simTime).period === 'night');
    if (d === 'energy') return fill(choose(w, 'chat-tired', TIRED_REPLIES, s.id), vars);
    if (d === 'social') return fill(choose(w, 'chat-lonely', LONELY_REPLIES, s.id), vars);
    if (d === 'fun') return fill(choose(w, 'chat-bored', BORED_REPLIES, s.id), vars);
    if (s.temperament.grumpiness > 0.5 && w.rng.chance(0.6, 'chat-grump', s.id)) return fill(choose(w, 'chat-grumpy', CHAT_REPLIES.grumpy!, s.id), vars);
    let cat = 'generic';
    for (const [re, c] of CHAT_PATTERNS) if (re.test(heard)) { cat = c; break; }
    return fill(choose(w, `chat-${cat}`, CHAT_REPLIES[cat]!, s.id), vars);
  },
  weather(w: World, s: Agent, weather: Weather, vars: Vars): string { return fill(choose(w, `weather-${weather}`, WEATHER_LINES[weather], s.id), vars); },
  raidAnnounce(w: World, s: Agent, vars: Vars): string { return fill(choose(w, 'raid-announce', RAID_ANNOUNCE, s.id), vars); },
  raidArrival(w: World, s: Agent, vars: Vars): string { return fill(choose(w, 'raid-arrival', RAID_ARRIVAL, s.id), vars); },
  raidWelcome(w: World, s: Agent, vars: Vars): string { return fill(choose(w, 'raid-welcome', RAID_WELCOME, s.id), vars); },
  raidFarewell(w: World, s: Agent, vars: Vars): string { return fill(choose(w, 'raid-farewell', RAID_FAREWELL, s.id), vars); },
  confetti(w: World, s: Agent, vars: Vars): string { return fill(choose(w, 'confetti', CONFETTI_LINES, s.id), vars); },
  danceJoin(w: World, s: Agent, vars: Vars): string { return fill(choose(w, 'dance-join', DANCE_JOIN, s.id), vars); },
  danceGrumble(w: World, s: Agent, vars: Vars): string { return fill(choose(w, 'dance-grumble', DANCE_GRUMBLE, s.id), vars); },
  bicker(w: World, s: Agent, vars: Vars): string { return fill(choose(w, 'bicker', BICKER_OPENERS, s.id), vars); },
  retort(w: World, s: Agent, vars: Vars): string { return fill(choose(w, 'retort', BICKER_RETORTS, s.id), vars); },
  lastWord(w: World, s: Agent, vars: Vars): string { return fill(choose(w, 'last-word', BICKER_LAST, s.id), vars); },
  apology(w: World, s: Agent, vars: Vars, pair: string): string { return fill(choosePair(w, pair, 'apology', APOLOGIES, s.id), vars); },
  apologyReply(w: World, s: Agent, yes: boolean, vars: Vars, pair: string): string { return fill(yes ? choosePair(w, pair, 'apology-yes', APOLOGY_YES, s.id) : choosePair(w, pair, 'apology-no', APOLOGY_NO, s.id), vars); },
  mutter(w: World, s: Agent, need: 'energy' | 'social' | 'fun'): string { return choose(w, `mutter:${need}`, DISTRESS_MUTTERS[need], s.id); },
  celebrateReply(w: World, s: Agent, vars: Vars): string { return fill(choose(w, 'celebrate', CELEBRATE_REPLIES, s.id), vars); },
  goodnight(w: World, s: Agent, vars: Vars): string { return fill(flavored(w, s, 'goodnight', GOODNIGHT_LINES, GOODNIGHT_BY_TRAIT, 0.4), vars); },
  restless(w: World, s: Agent, vars: Vars): string { return fill(choose(w, 'restless', RESTLESS_LINES, s.id), vars); },
  goodMorning(w: World, s: Agent, vars: Vars): string { return fill(flavored(w, s, 'good-morning', MORNING_LINES, MORNING_BY_TRAIT, 0.4), vars); },
};

export type MemoryKind = 'met' | 'greet' | 'chat' | 'rebuff' | 'compliment' | 'gift' | 'friends' | 'declined' | 'welcome' | 'reply' | 'raid' | 'asleep' | 'bicker' | 'makeup';

/** Clause templates keep both names + simple past so callbacks can personalise them ("you gave me…"). */
const MEMORY_CLAUSES: Record<MemoryKind, Bank> = {
  met: ['{a} met {b} {at}', '{a} said hello to {b} for the first time {at}', '{a} and {b} first crossed paths {at}', '{a} bumped into {b} {at}', '{a} and {b} got introduced {at}', '{a} struck up a conversation with {b} {at}'],
  greet: ['{a} greeted {b} {at}', '{a} waved hello to {b} {at}', '{a} stopped to say hi to {b} {at}', '{a} called out to {b} {at}', '{a} gave {b} a big hello {at}', '{a} said hey to {b} {at}'],
  chat: ['{a} and {b} chatted about {topic} {at}', '{a} and {b} talked about {topic} {at}', '{a} told {b} all about {topic} {at}', '{a} and {b} swapped stories about {topic} {at}', '{a} and {b} had a long talk about {topic} {at}', '{a} and {b} debated {topic} {at}'],
  rebuff: ['{a} tried to chat with {b} {at}', '{a} tried to start a conversation with {b} {at}', '{a} asked {b} how things were {at}', '{a} tried to cheer up {b} {at}', '{a} waved at {b} {at}', '{a} tried to make small talk with {b} {at}'],
  compliment: ["{a} complimented {b}'s {thing} {at}", "{a} raved about {b}'s {thing} {at}", "{a} admired {b}'s {thing} {at}", "{a} noticed {b}'s {thing} {at}", "{a} praised {b}'s {thing} {at}", "{a} told {b} the {thing} looked amazing {at}"],
  gift: ['{a} gave {b} {item} {at}', '{a} surprised {b} with {item} {at}', '{a} brought {b} {item} {at}', '{a} handed {b} {item} {at}', '{a} shared {item} with {b} {at}', '{a} left {item} for {b} {at}'],
  friends: ['{a} and {b} became friends {at}', '{a} and {b} made their friendship official {at}', '{a} and {b} sealed their friendship with a high five {at}', '{a} and {b} became inseparable {at}', '{a} and {b} shook on being friends {at}', '{a} asked {b} to be best friends {at}'],
  declined: ['{a} asked {b} to be friends {at}', '{a} offered {b} a friendship bracelet {at}', '{a} hoped to become friends with {b} {at}', '{a} asked {b} to be best friends {at}', '{a} popped the friendship question to {b} {at}', '{a} asked if {b} wanted to be friends {at}'],
  welcome: ['{a} welcomed {b} to town {at}', '{a} showed {b} around {at}', '{a} greeted {b} on arrival {at}', '{a} gave {b} a warm welcome {at}', '{a} was the first to welcome {b} {at}', '{a} told {b} all the best spots {at}'],
  reply: ['{a} chatted with {b} {at}', '{a} and {b} traded a few words {at}', '{b} answered {a} {at}', '{a} got a reply from {b} {at}', '{a} and {b} shared a laugh {at}', '{a} said something that made {b} reply {at}'],
  raid: ['{a} welcomed {b} through the portal', '{a} cheered as {b} arrived through the portal', '{a} high-fived {b} at the portal', '{a} met {b} when the raid arrived'],
  asleep: ['{a} tiptoed past a sleeping {b} {at}', '{a} tried to wake {b} {at}', '{a} found {b} fast asleep {at}'],
  bicker: ['{a} and {b} bickered about {topic} {at}', '{a} snapped at {b} about {topic} {at}', '{a} and {b} argued over {topic} {at}', '{a} told {b} off about {topic} {at}', '{a} and {b} had a spat about {topic} {at}', '{a} complained to {b} about {topic} {at}'],
  makeup: ['{a} apologized to {b} {at}', '{a} and {b} made up {at}', '{a} and {b} called a truce {at}', '{a} said sorry to {b} {at}', '{a} offered {b} a peace offering {at}', '{a} and {b} patched things up {at}'],
};
const MEMORY_ENDINGS: Record<string, Bank> = {
  'met+': ['{b} seemed delighted', '{b} said hi back', '{b} smiled right away', 'they hit it off', '{b} asked about the café', 'instant friends, probably'],
  'met-': ['{b} barely looked up', '{b} kept it short', '{b} seemed busy', 'it was a little awkward', '{b} mumbled a hello', '{b} wandered off'],
  'greet+': ['{b} beamed', '{b} waved back', '{b} smiled from ear to ear', '{b} waved with both hands', '{b} laughed', '{b} looked genuinely happy'],
  'greet-': ['{b} just grunted', '{b} looked away', '{b} was not in the mood', '{b} pretended not to hear', '{b} muttered something', '{b} sighed loudly'],
  'rebuff-': ['{b} was not in the mood', '{b} wanted some space', '{b} grumbled and walked off', '{b} barely looked up', '{b} sighed dramatically', 'it did not go well'],
  'compliment+': ['{b} blushed', '{b} beamed', '{b} grinned', '{b} did a little twirl', '{b} said thanks twice', '{b} pretended not to be pleased'],
  'compliment-': ['{b} rolled their eyes', '{b} shrugged it off', '{b} looked suspicious', '{b} did not buy it', '{b} changed the subject', '{b} said flattery will not work'],
  'gift+': ['{b} loved it', '{b} was thrilled', '{b} hugged {a}', '{b} kept smiling all day', '{b} promised to treasure it', '{b} did a happy dance'],
  'friends+': ['a proper high five', '{b} said yes', 'matching grins all round', 'they celebrated with cocoa', 'pinky promise included', 'the whole plaza cheered'],
  'declined-': ['{b} wants to hang out more first', '{b} said maybe after cocoa', '{b} wants to take it slow', '{b} needs a little more time', '{b} laughed and said not yet', '{b} said ask again tomorrow'],
  'welcome+': ['{b} waved hello', '{b} felt right at home', '{b} asked about the café', '{b} looked thrilled', '{b} promised to visit the stage', '{b} said thanks'],
  'welcome-': ['{a} grumbled a little', '{a} kept it short', '{a} muttered a welcome', '{a} did not smile much', '{a} looked suspicious', '{a} said wipe your feet'],
  'raid+': ['the whole raid cheered', 'confetti everywhere', 'what a party', 'so many new faces'],
  'asleep+': ['{b} snored on', '{b} mumbled something about waffles', '{b} did not stir'],
  'bicker-': ['{b} rolled their eyes', 'both stormed off', 'nobody won', '{b} stuck out their tongue', '{b} huffed and walked away', 'the whole plaza heard it'],
  'makeup+': ['{b} accepted with a grin', 'hugs all round', 'cocoa was involved', 'they laughed it off', 'friends again', '{b} said it was already forgotten'],
  'makeup-': ['{b} needs a bit more time', '{b} said maybe later', '{b} crossed their arms', '{b} was still annoyed', '{b} did not say a word', '{b} turned away'],
};

/** "clause — tail" with varied phrasing (≥ 6 variants for common kinds), deterministic and non-repeating. */
export function memoryLine(w: World, kind: MemoryKind, positive: boolean, v: Vars, quote?: string): string {
  const clause = fill(choose(w, `mem-c:${kind}`, MEMORY_CLAUSES[kind], v.a ?? ''), v);
  const tails = MEMORY_ENDINGS[`${kind}${positive ? '+' : '-'}`] ?? MEMORY_ENDINGS[`${kind}+`];
  const tail = quote ? `"${quote}"` : tails ? fill(choose(w, `mem-t:${kind}${positive ? '+' : '-'}`, tails, v.a ?? ''), v) : '';
  return tail ? `${clause} — ${tail}` : clause;
}

/** A compliment-worthy detail of someone's look ("varsity jacket", "teal hair", "dance moves"). */
export function complimentThing(w: World, target: Agent): string {
  const a = target.appearance;
  const TOP: Record<string, string> = { tee: 'shirt', hoodie: 'hoodie', sweater: 'sweater', jacket: 'jacket', tank: 'tank top', dress: 'dress', blouse: 'blouse', varsity: 'varsity jacket' };
  const ACC: Record<string, string> = { glasses: 'glasses', sunglasses: 'sunglasses', beanie: 'beanie', cap: 'cap', headphones: 'headphones', scarf: 'scarf', earrings: 'earrings', backpack: 'backpack', flower: 'hair flower', bowtie: 'bow tie', crown: 'party crown' };
  const HAIR: Record<string, string> = { afro: 'afro', braids: 'braids', mohawk: 'mohawk', curly: 'curls', bun: 'top bun', ponytail: 'ponytail', bob: 'bob', spiky: 'spiky hair', long: 'hair' };
  const options: string[] = [];
  if (TOP[a.outfit.top]) options.push(TOP[a.outfit.top]!);
  for (const acc of a.accessories) if (ACC[acc]) options.push(ACC[acc]!);
  if (HAIR[a.hairStyle]) options.push(HAIR[a.hairStyle]!);
  options.push('smile', target.activity.startsWith('dancing') ? 'dance moves' : 'style');
  return w.rng.pick(options, 'thing', target.id);
}

// ---------------------------------------------------------------------------
// Optional LLM dialogue
// ---------------------------------------------------------------------------
export interface DialogueContext {
  worldId: string;
  purpose: 'conversation' | 'reply';
  speaker: { id: string; name: string; personality: string[]; mood: number };
  listener?: { id: string; name: string; personality: string[] };
  friendship?: number;
  /** Most recent shared memories (human-readable). */
  memories: string[];
  /** Text being replied to (viewer chat), when any. */
  heard?: string;
  weather: Weather;
  time: string;
  place: string;
  /** The deterministic template line already used; a good style reference. */
  fallback: string;
}

export interface DialogueProvider {
  generate(ctx: DialogueContext): Promise<string | null>;
}

export interface HttpDialogueOptions {
  /** App-server endpoint that holds the model keys. Receives POST { context } JSON. */
  endpoint: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}

/** Trim model output to one short, safe speech line (≤ 140 chars). */
export function sanitizeDialogue(text: unknown): string {
  if (typeof text !== 'string') return '';
  const s = cleanText(text.replace(/^["'\s]+|["'\s]+$/g, '').split('\n')[0] ?? '', 140);
  return s.length >= 2 ? s : '';
}

export function createHttpDialogueProvider(options: HttpDialogueOptions): DialogueProvider {
  const timeoutMs = Math.max(200, Math.min(20000, options.timeoutMs ?? 4000));
  return {
    async generate(ctx) {
      const f = options.fetch ?? (typeof fetch === 'function' ? fetch : undefined);
      if (!f) return null;
      const ctrl = typeof AbortController === 'function' ? new AbortController() : undefined;
      const timer = setTimeout(() => ctrl?.abort(), timeoutMs);
      try {
        const res = await f(options.endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
          body: JSON.stringify({ context: ctx }),
          signal: ctrl?.signal,
        });
        if (!res.ok) return null;
        const type = res.headers.get('content-type') ?? '';
        let out: unknown;
        if (type.includes('json')) {
          const j = (await res.json()) as unknown;
          out = typeof j === 'string' ? j : (j as { text?: unknown; line?: unknown } | null)?.text ?? (j as { line?: unknown } | null)?.line;
        } else out = await res.text();
        return sanitizeDialogue(out) || null;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

const registry = new Map<string, DialogueProvider>();

/** Attach an LLM provider to every simulation of a world id (e.g. from the server, which never sees the Simulation object). */
export function registerDialogueProvider(worldId: string, provider: DialogueProvider | null): void {
  if (provider) registry.set(worldId, provider); else registry.delete(worldId);
}

export function providerFor(w: World): DialogueProvider | null {
  return w.llm.provider ?? registry.get(w.worldId) ?? null;
}

const LLM_COOLDOWN = 12;
const LLM_MAX_IN_FLIGHT = 2;

/** Fire-and-forget request for an EXTRA line; results are emitted by the next step as chat events. */
export function requestExtraLine(
  w: World, purpose: DialogueContext['purpose'], speaker: Agent, listener: Agent | null,
  fallback: string, memories: readonly string[], friendship: number | undefined, place: string, heard?: string,
): void {
  const provider = providerFor(w);
  if (!provider || w.llm.inFlight >= LLM_MAX_IN_FLIGHT || w.simTime < w.llm.nextAt) return;
  w.llm.nextAt = w.simTime + LLM_COOLDOWN;
  w.llm.inFlight++;
  const requestedAt = w.simTime;
  const ctx: DialogueContext = {
    worldId: w.worldId,
    purpose,
    speaker: { id: speaker.id, name: speaker.displayName, personality: [...speaker.personality], mood: Math.round(speaker.mood * 100) / 100 },
    ...(listener ? { listener: { id: listener.id, name: listener.displayName, personality: [...listener.personality] } } : {}),
    ...(friendship !== undefined ? { friendship: Math.round(friendship) } : {}),
    memories: memories.slice(-3),
    ...(heard ? { heard } : {}),
    weather: w.weather,
    time: worldClock(w.simTime).label,
    place,
    fallback,
  };
  let p: Promise<string | null>;
  try { p = provider.generate(ctx); } catch { w.llm.inFlight--; return; }
  Promise.resolve(p).then(text => {
    const line = sanitizeDialogue(text);
    if (line && line !== fallback) w.llm.ready.push({ speakerId: speaker.id, ...(listener ? { listenerId: listener.id } : {}), text: line, requestedAt });
  }, () => undefined).finally(() => { w.llm.inFlight = Math.max(0, w.llm.inFlight - 1); });
}
