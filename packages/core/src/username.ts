// Username rules, shared by the server (which enforces them) and every client
// (which validates as you type). Usernames are public in the community, so
// look-alike names must collapse to the same account name.

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 24;

const RESERVED = new Set([
  'admin',
  'administrator',
  'perch',
  'support',
  'help',
  'moderator',
  'mod',
  'root',
  'system',
  'staff',
  'official',
  'security',
  'api',
  'www',
  'null',
  'undefined',
  'anonymous',
  'me',
]);

// Cyrillic and Greek letters that render like Latin ones. NFKC already folds
// full-width and stylised forms; these survive it.
const CONFUSABLES: Record<string, string> = {
  а: 'a',
  в: 'b',
  е: 'e',
  к: 'k',
  м: 'm',
  н: 'h',
  о: 'o',
  р: 'p',
  с: 'c',
  т: 't',
  у: 'y',
  х: 'x',
  ѕ: 's',
  і: 'i',
  ј: 'j',
  ӏ: 'l',
  ԁ: 'd',
  ɡ: 'g',
  ո: 'n',
  ս: 'u',
  ԝ: 'w',
  α: 'a',
  β: 'b',
  ε: 'e',
  ι: 'i',
  κ: 'k',
  ν: 'v',
  ο: 'o',
  ρ: 'p',
  τ: 't',
  υ: 'u',
  χ: 'x',
  ı: 'i',
};

/**
 * The canonical form a username is stored and compared under: NFKC, lower case,
 * look-alike letters mapped to Latin, accents dropped ("Çınar" → "cinar"). Does
 * not validate.
 */
export function normalizeUsername(raw: string): string {
  return [...raw.trim().normalize('NFKC').toLowerCase()]
    .map((ch) => CONFUSABLES[ch] ?? ch)
    .join('')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '');
}

export type UsernameProblem = 'too-short' | 'too-long' | 'invalid-characters' | 'reserved';

/** Validate an already-normalised username. Returns null when it is acceptable. */
export function usernameProblem(name: string): UsernameProblem | null {
  if (name.length < USERNAME_MIN) return 'too-short';
  if (name.length > USERNAME_MAX) return 'too-long';
  if (!/^[a-z0-9_.]+$/.test(name)) return 'invalid-characters';
  if (RESERVED.has(name.replace(/[_.]/g, ''))) return 'reserved';
  return null;
}

// Suggested names: two plain words and a number, so nobody has to put their
// own name (or anything else about them) on a public profile.
const ADJECTIVES = [
  'quiet',
  'amber',
  'misty',
  'calm',
  'brisk',
  'gentle',
  'golden',
  'hidden',
  'lucky',
  'mellow',
  'nimble',
  'patient',
  'rustic',
  'silver',
  'sleepy',
  'steady',
  'sunny',
  'tidy',
  'wild',
  'windy',
  'bright',
  'cosy',
  'curious',
  'dusky',
  'early',
  'fuzzy',
  'hazel',
  'humble',
  'jolly',
  'little',
  'lofty',
  'merry',
  'olive',
  'plucky',
  'rapid',
  'shy',
  'snowy',
  'swift',
  'velvet',
  'wandering',
];
const NOUNS = [
  'heron',
  'finch',
  'wren',
  'robin',
  'owl',
  'sparrow',
  'swallow',
  'lark',
  'kestrel',
  'puffin',
  'otter',
  'badger',
  'fox',
  'hare',
  'lynx',
  'marten',
  'beaver',
  'seal',
  'moth',
  'beetle',
  'birch',
  'cedar',
  'fern',
  'maple',
  'willow',
  'pine',
  'reed',
  'moss',
  'brook',
  'cove',
  'dune',
  'glade',
  'harbor',
  'meadow',
  'pebble',
  'ridge',
  'tide',
  'valley',
  'reader',
  'page',
];

export function suggestUsername(): string {
  const [a, b, n] = crypto.getRandomValues(new Uint32Array(3));
  return `${ADJECTIVES[a! % ADJECTIVES.length]}_${NOUNS[b! % NOUNS.length]}${10 + (n! % 90)}`;
}
