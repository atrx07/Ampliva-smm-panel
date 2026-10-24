import { platformLabels } from './format';
import type { Service } from '../types';

// Collapsed-row summaries. Provider names repeat the platform ("Instagram
// Likes", "Telegram Members") and bury the point in marketing detail, so
// the small banner shows a short form instead: platform chip, service,
// speed, price. The expanded view keeps the full provider name untouched.

// Words the provider puts at the front of a name that the chip already
// says (or, for "other" services, that the chip should say instead of
// the useless "Other").
const PLATFORM_WORDS = [
  'instagram', 'youtube', 'facebook', 'telegram', 'twitter', 'tiktok',
  'whatsapp', 'linkedin', 'threads', 'snapchat', 'discord', 'website',
];

const CHIP_WORDS: Record<string, string> = {
  instagram: 'Instagram',
  youtube: 'YouTube',
  facebook: 'Facebook',
  telegram: 'Telegram',
  twitter: 'X',
  tiktok: 'TikTok',
  whatsapp: 'WhatsApp',
  linkedin: 'LinkedIn',
  threads: 'Threads',
  snapchat: 'Snapchat',
  discord: 'Discord',
  website: 'Website',
};

// Qualifiers that follow the platform word and add nothing once the chip
// is visible ("Facebook Page/Profile Followers" -> "Followers").
const FILLER_PREFIXES = ['page/profile', 'page', 'profile'];

// Words that end the short label: everything from here on is marketing,
// refill terms, durations or delivery detail, not the service itself.
const STOP_WORDS = new Set([
  'non', 'drop', 'instant', 'lifetime', 'guaranteed', 'refill', 'refil',
  'hq', 'real', 'max', 'min', 'cheap', 'cheapest', 'best', 'quality',
  'active', 'super', 'fast', 'slow', 'stable', 'premium', 'organic',
  'genuine', 'safe', 'secure', 'high', 'low', 'old', 'accounts', 'speed',
  'start', 'drip', 'gradual', 'feed', 'update', 'working', 'package',
  'from', 'website',
]);

// Qualifier words that may LEAD a name ("No Drop Members") — skipped
// rather than ending the label, so the noun behind them survives.
const LEAD_SKIP_WORDS = new Set(['no', 'non', 'drop', 'not', 'without']);

// A segment that is only a country ("Telegram · Germany · Random
// Comments") is a qualifier, not a label — remembered and appended to the
// real label instead ("Random Comments · Germany").
const COUNTRY_WORDS = new Set([
  'germany', 'turkey', 'israel', 'russia', 'china', 'arabic', 'indian',
  'india', 'usa', 'uk', 'arab', 'usa-uk', 'korea', 'brazil', 'france',
  'spain', 'italy', 'canada', 'australia', 'pakistan', 'bangladesh',
  'nigeria', 'egypt', 'iran', 'iraq', 'vietnam', 'thailand', 'indonesia',
  'malaysia', 'philippines', 'mexico', 'argentina', 'colombia', 'peru',
  'chile', 'poland', 'romania', 'ukraine', 'netherlands', 'belgium',
  'sweden', 'norway', 'denmark', 'finland', 'greece', 'portugal',
  'austria', 'switzerland', 'ireland', 'kenya', 'morocco', 'saudi', 'uae',
]);

// Speed is pulled out of the full name into its own slot. Patterns run
// most-specific first: ranges before singles, "/day" before "/d".
// The quantity suffix covers k and M ("10k/day", "10m/day").
const SPEED_PATTERNS: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
  [/(\d[\d,.]*\s*[kKmM]?\s*[-–]\s*\d[\d,.]*\s*[kKmM]?)\s*\/\s*day/i,
    (m) => `${m[1].replace(/\s+/g, '').toLowerCase()}/day`],
  [/(\d[\d,.]*\s*[kKmM]?)\s*\/\s*day/i,
    (m) => `${m[1].replace(/\s+/g, '').toLowerCase()}/day`],
  [/(\d[\d,.]*\s*[kKmM]?)\s+day\s+speed/i,
    (m) => `${m[1].replace(/\s+/g, '').toLowerCase()}/day`],
  [/(\d[\d,.]*\s*[kKmM]?\s*[-–]\s*\d[\d,.]*\s*[kKmM]?)\s*\/\s*d\b/i,
    (m) => `${m[1].replace(/\s+/g, '').toLowerCase()}/day`],
  [/(\d[\d,.]*\s*[kKmM]?)\s*\/\s*d\b/i,
    (m) => `${m[1].replace(/\s+/g, '').toLowerCase()}/day`],
];

const PLATFORM_RE = new RegExp(`^(${PLATFORM_WORDS.join('|')})\\b[\\s·/|-]*`, 'i');
const FILLER_RE = new RegExp(`^(${FILLER_PREFIXES.join('|')})\\b[\\s·/|-]*`, 'i');
const LEADING_WORD_RE = new RegExp(`^(${PLATFORM_WORDS.join('|')})\\b`, 'i');

function parts(word: string): string[] {
  return word.toLowerCase().split(/[-/]/);
}

function hasStopPart(word: string): boolean {
  return parts(word).some((part) => STOP_WORDS.has(part));
}

function hasLeadPart(word: string): boolean {
  return parts(word).some((part) => LEAD_SKIP_WORDS.has(part));
}

// The chip for "other" services reads the platform off the name
// ("WhatsApp Channel Members" -> "WhatsApp") instead of the useless
// "Other"; named platforms keep their normal label.
export function chipLabel(service: Service): string {
  if (service.platform !== 'other') return platformLabels[service.platform];
  const match = service.name.match(LEADING_WORD_RE);
  if (!match) return platformLabels.other;
  return CHIP_WORDS[match[1].toLowerCase()] ?? platformLabels.other;
}

// Words of one segment, cleaned: leading platform/filler/qualifier words
// dropped, walking stops at the first detail word. A leading quantity
// ("100K Reels Views") is skipped, not fatal.
function segmentWords(segment: string): string[] {
  let text = segment.replace(PLATFORM_RE, '').replace(FILLER_RE, '');
  text = text.replace(/^[^a-z0-9]+/i, '');
  const rawWords = text.split(/\s+/).filter(Boolean);

  let index = 0;
  while (index < rawWords.length) {
    const clean = rawWords[index].replace(/^[(\[]+|[)\],;:]+$/g, '');
    if (clean && hasLeadPart(clean)) {
      index += 1;
      continue;
    }
    break;
  }

  const words: string[] = [];
  for (; index < rawWords.length; index += 1) {
    const raw = rawWords[index];
    const word = raw.replace(/^[(\[]+|[)\],;:]+$/g, '');
    if (!word) continue;
    if (word === '+') {
      // "+" joins a secondary item ("Comments + View"): once the label
      // is already specific, the rest is detail; otherwise skip past it.
      if (words.length >= 2) break;
      continue;
    }
    if (word.length === 1) continue; // separator artifacts ("l" for "|")
    if (/^\d/.test(word)) {
      if (words.length === 0) continue; // leading quantity, not a stop
      break;
    }
    if (hasStopPart(word)) break;
    words.push(word);
    if (words.length >= 4) break;
  }
  return words;
}

export function shortService(service: Service): { label: string; speed: string | null } {
  const name = service.name;

  let speed: string | null = null;
  let speedRaw: string | null = null;
  for (const [pattern, format] of SPEED_PATTERNS) {
    const match = name.match(pattern);
    if (match) {
      speed = format(match);
      speedRaw = match[0];
      break;
    }
  }

  // Provider names separate the core from detail with "·"
  // ("Instagram Likes · HQ Old Accounts · Lifetime Refill"). Walk the
  // segments in order; a lone country segment is remembered, not used.
  let country: string | null = null;
  let label = '';
  for (const segment of name.split(/[·|]/)) {
    const text = speedRaw ? segment.replace(speedRaw, ' ') : segment;
    const words = segmentWords(text);
    if (words.length === 0) continue;
    if (words.length === 1 && COUNTRY_WORDS.has(words[0].toLowerCase())) {
      country ??= words[0];
      continue;
    }
    label = words.join(' ');
    break;
  }

  if (!label) return { label: 'Service', speed };
  if (country) label += ` · ${country}`;
  return { label, speed };
}
