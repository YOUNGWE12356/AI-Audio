// Conservative metadata matching, not audio recognition. A site's category/tag
// alone cannot establish that an effect matches the requested sound.
const words = (text: string) => text.normalize('NFKC').toLowerCase().match(/[a-z]+/g) || [];
const stem = (word: string) => {
  if (word.endsWith('ies') && word.length > 4) return word.slice(0, -3) + 'y';
  if (word.endsWith('ing') && word.length > 5) {
    const root = word.slice(0, -3);
    return /([bdfgmnprt])\1$/.test(root) ? root.slice(0, -1) : root;
  }
  if (word.endsWith('ed') && word.length > 4) return word.slice(0, -2);
  if (/(?:ches|shes|xes|zes|sses)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) return word.slice(0, -1);
  return word;
};
const STOP_WORDS = new Set(('a an the and or of for to from with without in on at by into near sound sounds effect effects '
  + 'audio sfx sample samples recording recorded record version loop looping ambience ambient background '
  + 'please find search me some realistic natural clean clear short long single one').split(' ').map(stem));

// Directional expansions: water may include a splash, but a request specifically
// for a splash must not pass merely because the title says "water".
const RELATED: Record<string, string[]> = {
  water: ['liquid', 'splash', 'splatter', 'drip', 'pour', 'river', 'stream', 'brook', 'bubble', 'gurgle', 'wave', 'sea', 'ocean', 'waterfall', 'rain', 'shower', 'swimming'],
  liquid: ['water', 'splash', 'drip', 'pour', 'bubble', 'gurgle'],
  splash: ['splatter', 'splosh'],
  drip: ['dripping', 'dribble'],
  rain: ['rainfall', 'downpour', 'drizzle'],
  wave: ['surf', 'ocean', 'sea'],
  whoosh: ['woosh', 'swoosh', 'swish'],
  woosh: ['whoosh', 'swoosh', 'swish'],
  swoosh: ['whoosh', 'woosh', 'swish'],
  swish: ['whoosh', 'woosh', 'swoosh'],
  wood: ['wooden'], wooden: ['wood'],
  metal: ['metallic', 'steel', 'iron'],
  creak: ['creaking', 'squeak', 'squeaking'],
  squeak: ['squeaking', 'creak', 'creaking'],
  bird: ['birdsong', 'chirp', 'chirping', 'tweet', 'tweeting'],
  dog: ['bark', 'barking', 'woof'],
  cat: ['meow', 'mew', 'purr', 'purring'],
  footstep: ['footsteps', 'footfall', 'walking', 'walk', 'running', 'run'],
  explosion: ['explode', 'exploding', 'blast', 'detonation'],
  fire: ['flame', 'burn', 'burning', 'fireplace'],
  magic: ['magical', 'spell', 'enchant', 'enchantment'],
  click: ['clicking'],
  door: ['doors'],
  wind: ['gust', 'howling'],
};
const alternatives = (term: string) => new Set([term, ...(RELATED[term] || []).map(stem)]);

export function createOnlineSfxRelevanceMatcher(query: string) {
  const terms = [...new Set(words(query).map(stem).filter(word => !STOP_WORDS.has(word)))];
  // Generic descriptions cannot qualify an unrelated effect on their own.
  if (!terms.length) return (_title: string) => 0;
  const groups = terms.map(alternatives);
  const required = terms.length <= 4 ? terms.length : Math.max(2, Math.ceil(terms.length * 0.6));
  return (title: string) => {
    // A location is not necessarily audible: "birds chirping near the river"
    // is not evidence of water, unlike "river flowing with birds".
    const foreground = title.split(/\b(?:near|beside|next to|surrounded by|on|at|in|by)\b/i)[0];
    const titleWords = new Set(words(foreground).map(stem));
    let matched = 0, exact = 0;
    for (let index = 0; index < groups.length; index++) {
      if ([...groups[index]].some(word => titleWords.has(word))) matched++;
      if (titleWords.has(terms[index])) exact++;
    }
    if (matched < required) return 0;
    // For long requests, never let several style/action words substitute for
    // the explicitly requested sound source.
    const sourceTerms = new Set(['water', 'liquid', 'rain', 'wave', 'wood', 'wooden', 'metal', 'bird', 'dog', 'cat',
      'footstep', 'explosion', 'fire', 'door', 'wind', 'glass', 'car', 'bell', 'gun', 'sword', 'piano']);
    if (terms.some((term, index) => sourceTerms.has(term) && ![...groups[index]].some(word => titleWords.has(word)))) return 0;
    return exact * 2 + matched;
  };
}
