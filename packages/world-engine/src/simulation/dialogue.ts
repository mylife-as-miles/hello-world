/**
 * Dialogue: deterministic, personality/relationship/weather/time-aware line
 * templates (always the default + fallback), with global anti-repetition, plus
 * an OPTIONAL async LLM provider whose lines are only ever added as extra chat
 * events (never state changes).
 */
import type { Weather } from '@hello-world/contracts';
import type { PoiDef } from '../world/layout';
import { worldClock, type WorldClock } from '../world/time';
import { cleanText, type Agent, type World } from './state';

type Bank = readonly string[];
type Vars = Record<string, string | undefined>;

export function fill(template: string, vars: Vars): string {
  return template.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? '').replace(/\s+([,.!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

/** Pick from a bank, avoiding templates used recently anywhere in town. */
export function choose(w: World, key: string, bank: Bank, salt: string): string {
  let idx = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    idx = w.rng.int(bank.length, `line:${key}`, salt);
    if (!w.recentLines.includes(`${key}#${idx}`)) break;
  }
  w.recentLines.push(`${key}#${idx}`);
  if (w.recentLines.length > 48) w.recentLines.shift();
  return bank[idx]!;
}

function flavored(w: World, a: Agent, key: string, generic: Bank, byTrait: Partial<Record<string, Bank>>, p = 0.5): string {
  const traits = a.personality.filter(t => byTrait[t]);
  const grumpy = traits.includes('grumpy');
  if (traits.length && w.rng.chance(grumpy ? 0.75 : p, `flavor:${key}`, a.id)) {
    const t = grumpy ? 'grumpy' : w.rng.pick(traits, `flavor-t:${key}`, a.id);
    return choose(w, `${key}:${t}`, byTrait[t]!, a.id);
  }
  return choose(w, key, generic, a.id);
}

const first = (name: string) => name;

// ---------------------------------------------------------------------------
// Banks
// ---------------------------------------------------------------------------
const OPENERS: Record<WorldClock['period'], Bank> = {
  morning: [
    'Morning, {name}! Sleep okay?', 'Good morning, {name}! The air smells like cinnamon buns.', '{name}! Early bird, huh?',
    'Hey {name}, coffee first or chit-chat first?', 'Rise and shine, {name}!', 'Morning, {name}! Big plans today?',
  ],
  afternoon: [
    'Afternoon, {name}! What have you been up to?', 'Hey {name}! Perfect day for a stroll.', 'Oh hi, {name}! Fancy meeting you {at}.',
    '{name}! Just the person I wanted to see.', 'Heyyy {name}, how is your day going?', '{name}! Long time no see. Like, an hour.',
  ],
  evening: [
    'Evening, {name}! The lamps are flickering on.', 'Hey {name}, catching the golden hour?', '{name}! You heading to the stage tonight?',
    'Look who it is! Evening, {name}.', '{name}! Perfect evening for a wander, right?',
  ],
  night: [
    'Still up, {name}? Me too.', 'Hey {name}... the stars are wild tonight.', 'Welcome to the night owl club, {name}.',
    '{name}! Fancy seeing you out this late.', 'Psst, {name}. The town is so pretty at night.',
  ],
};
const OPENERS_BY_TRAIT: Partial<Record<string, Bank>> = {
  grumpy: ['Oh. It’s you, {name}.', '{name}. Don’t make it weird.', 'Hmph. Hello, {name}.', '{name}. I suppose you want to chat.'],
  shy: ['Oh! Um, hi {name}...', 'H-hey {name}. Nice to see you.', 'Hi {name}... I was hoping I’d see you.'],
  playful: ['{name}! Tag, you’re it!', 'Psst, {name}. Wanna hear a secret? Kidding. Hi!', '{name}! Bet you can’t guess what I just saw.'],
  chaotic: ['{name}! I’ve SO much to tell you. Most of it’s true.', '{name}!! Did you see that pigeon? Iconic.', '{name}, quick: cats or capes? Wrong. Both.'],
  romantic: ['{name}, you’re glowing today!', 'Hello, {name}. This place suits you.'],
  bookish: ['Hello, {name}. I just finished a chapter, perfect timing.', '{name}! I was reading about you. Kidding. Hi!'],
  foodie: ['{name}! Have you tried the new pastries yet?', '{name}, I smell waffles. Do you smell waffles?'],
  competitive: ['{name}. Rematch at the arcade later?', '{name}! Ready to lose at Star Blaster again?'],
  energetic: ['{name}! Race you to the fountain!', '{name}! Isn’t today amazing?!'],
  kind: ['{name}! I hope your day has been lovely.', 'Hi {name}! You look like you could use a friend.'],
  curious: ['{name}! Did you know the fountain hums at night?', '{name}, ever wonder where the portal goes?'],
  friendly: ['{name}! Always great to see you!', 'Hey hey, {name}!'],
  creative: ['{name}! I just had the best idea for a dance move.', '{name}, the light here is gorgeous today.'],
  lazy: ['Oh hey {name}. Don’t mind me, just conserving energy.', '{name}... is it nap o’clock yet?'],
  'night-owl': ['The night is young, {name}!', '{name}! Finally, someone who gets it. Night is the best.'],
};

const INTROS: Bank = [
  'Hi! I’m {me}. I don’t think we have met!', 'Hello there! {me}, nice to meet you.', 'Hey, are you new around here? I’m {me}!',
  'Hi! {me}. I live over at {home}.', 'Oh, a new face! I’m {me}.',
];
const INTROS_BY_TRAIT: Partial<Record<string, Bank>> = {
  grumpy: ['...I’m {me}. You’re new.', 'Name’s {me}. Don’t wear it out.'],
  shy: ['Um, hi... I’m {me}. Nice to meet you.'],
  playful: ['Hi hi! I’m {me}, local legend. Allegedly.'],
};
const VISITOR_INTROS: Bank = [
  'Hi! I came through the portal with the {channel} raid!', 'Hello! Visiting from {channel}. This town is adorable!', 'Hey! Raid party member, reporting for fun!',
];
const INTRO_REPLIES_POS: Bank = [
  '{name}! Lovely to meet you. I’m {me}.', 'Hi {name}! I’m {me}. We’re going to be friends, I can tell.',
  'Oh hey! {me}. Welcome to my favorite-neighbors list, {name}.', 'Nice to meet you, {name}! I’m {me}.',
];
const INTRO_REPLIES_NEG: Bank = ['Mm. {me}. Hi, I guess.', '{me}. Nice to... yeah.', 'I’m {me}. I’m also busy.'];

const RESPONSES_POS: Bank = [
  'Hey {name}! Great to see you!', 'Oh, hi {name}! You just made my day.', '{name}! I was hoping I’d run into you.',
  'Ha, hi {name}! Always a pleasure.', 'Hiya {name}! Pull up a cobblestone.', 'Hey you! How is it going, {name}?',
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
  '{name}, I’ve had a day. Later?',
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
const NEWCOMER_TOPIC: TopicDef = { id: 'newcomer', label: 'the new neighbor', lines: ['Have you met {newcomer} yet? They just moved in.', '{newcomer} just arrived through the portal!'], replies: ['Not yet! Let’s say hi.', 'The more the merrier.'] };
const DANCER_TOPIC: TopicDef = { id: 'dancer', label: 'the dance stage', lines: ['{dancer} is tearing up the stage!', 'Have you seen {dancer} dance? Wow.'], replies: ['Those moves!', 'We should join!'] };
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
  'Welcome, {name}! You picked a great day to move in.', 'Hi {name}! Welcome! You’re going to love it here.',
];
const WELCOMES_BY_TRAIT: Partial<Record<string, Bank>> = {
  grumpy: ['Another one. ...Welcome, {name}.', 'Hmph. Welcome, {name}. Wipe your feet.'],
  foodie: ['Welcome, {name}! First stop: Sunbeam Café. Trust me.'],
  playful: ['Welcome, {name}! You’re it! Kidding. Welcome!'],
};
const NEWCOMER_HELLO: Bank = ['Hi everyone! I’m {me}!', 'Hello, neighborhood!', 'Wow, this place is even cuter in person!', 'Hi! Just moved in. I’m {me}!'];
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
const BEFRIEND_MILESTONE: Bank = ['{name}, I think we’re officially friends now!', 'Friends? Friends. Definitely friends, {name}.', 'You know what, {name}? You’re one of my favorite people.'];

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------
export interface Topic { id: string; label: string; line: string; reply: string; joke: boolean }

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
    reply: fill(choose(w, `reply:${t.id}`, t.replies, s.id), vars),
  };
}

/** Weighted topic choice: memories (high friendship), happenings, weather, place, needs, hobbies, time. */
export function pickTopic(ctx: TopicContext): Topic {
  const { w, speaker, listener, place, friendship, memories, vars } = ctx;
  const clock = worldClock(w.simTime);
  const cands: Array<{ w: number; make: () => Topic | null }> = [];
  if (friendship >= 65 && memories.length) {
    cands.push({ w: 2.2, make: () => {
      const cb = memoryCallback(w, speaker, listener, memories);
      return cb ? { id: 'memory', label: 'old times', line: cb, reply: fill(choose(w, 'reply:memory', MEMORY_REPLIES, listener.id), vars), joke: false } : null;
    } });
  }
  if (w.simTime - w.facts.raidAt < 200 && w.facts.raidChannel) cands.push({ w: 1.6, make: () => heTopic(RAID_TOPIC, w, speaker, vars) });
  if (w.simTime - w.facts.confettiAt < 90) cands.push({ w: 1.2, make: () => heTopic(CONFETTI_TOPIC, w, speaker, vars) });
  const nc = w.facts.newcomer;
  if (nc && w.simTime - nc.at < 240 && nc.name !== speaker.displayName && nc.name !== listener.displayName) {
    cands.push({ w: 1.2, make: () => heTopic(NEWCOMER_TOPIC, w, speaker, { ...vars, newcomer: nc.name }) });
  }
  const dancer = [...w.agents.values()].find(o => o !== speaker && o !== listener && o.activity.startsWith('dancing'));
  if (dancer) cands.push({ w: 0.9, make: () => heTopic(DANCER_TOPIC, w, speaker, { ...vars, dancer: dancer.displayName }) });
  cands.push({ w: w.weather === 'sunny' ? 0.55 : 1.4, make: () => heTopic(WEATHER_TOPICS[w.weather], w, speaker, vars) });
  const pt = PLACE_TOPICS[place.kind];
  if (pt) cands.push({ w: 0.9, make: () => heTopic(pt, w, speaker, vars) });
  const needs = speaker.needs;
  if (needs.energy < 30) cands.push({ w: 1.1, make: () => heTopic(NEED_TOPICS.energy, w, speaker, vars) });
  if (needs.fun < 30) cands.push({ w: 1, make: () => heTopic(NEED_TOPICS.fun, w, speaker, vars) });
  if (needs.social < 25) cands.push({ w: 0.9, make: () => heTopic(NEED_TOPICS.social, w, speaker, vars) });
  for (const trait of speaker.personality) {
    const t = TRAIT_TOPICS[trait];
    if (t) cands.push({ w: 0.8, make: () => heTopic(t, w, speaker, vars) });
  }
  cands.push({ w: 0.6, make: () => heTopic(TIME_TOPICS[clock.period], w, speaker, vars) });
  let total = 0;
  for (const c of cands) total += c.w;
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

export function memoryClause(memory: string): string {
  const afterStamp = memory.includes(' · ') ? memory.slice(memory.indexOf(' · ') + 3) : memory;
  const cut = afterStamp.indexOf(' — ');
  return (cut >= 0 ? afterStamp.slice(0, cut) : afterStamp).replace(/[.!]+$/, '').trim();
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
    const period = worldClock(w.simTime).period;
    return fill(flavored(w, s, `open:${period}`, OPENERS[period], OPENERS_BY_TRAIT, 0.45), vars);
  },
  intro(w: World, s: Agent, vars: Vars): string { return fill(s.visitor ? choose(w, 'intro-visitor', VISITOR_INTROS, s.id) : flavored(w, s, 'intro', INTROS, INTROS_BY_TRAIT, 0.5), vars); },
  introReply(w: World, s: Agent, positive: boolean, vars: Vars): string {
    return fill(choose(w, positive ? 'intro-pos' : 'intro-neg', positive ? INTRO_REPLIES_POS : INTRO_REPLIES_NEG, s.id), vars);
  },
  response(w: World, s: Agent, positive: boolean, vars: Vars): string {
    if (!positive) return fill(s.needs.energy < 20 ? choose(w, 'resp-tired', RESPONSES_TIRED, s.id) : choose(w, 'resp-neg', RESPONSES_NEG, s.id), vars);
    return fill(flavored(w, s, 'resp-pos', RESPONSES_POS, RESPONSES_POS_BY_TRAIT, 0.5), vars);
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
  celebrateReply(w: World, s: Agent, vars: Vars): string { return fill(choose(w, 'celebrate', CELEBRATE_REPLIES, s.id), vars); },
};

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
