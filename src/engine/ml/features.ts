/**
 * Caractéristiques lexicales d'un nom d'hôte pour le modèle embarqué.
 * DOIT rester identique à tools/ml/train.py (un test compare les deux implémentations).
 */

export const NGRAM_BUCKETS = 4096;
export const NUMERIC_FEATURES = 9;
export const FEATURE_COUNT = NGRAM_BUCKETS + NUMERIC_FEATURES;

export const RISKY_TLDS: ReadonlySet<string> = new Set([
  'top', 'xyz', 'icu', 'shop', 'online', 'site', 'live', 'click', 'buzz', 'cfd', 'sbs', 'rest', 'monster', 'cyou', 'bond',
  'lol', 'fun', 'store', 'support', 'help', 'cam', 'quest', 'mom', 'beauty', 'hair', 'skin', 'makeup', 'autos', 'boats',
  'yachts', 'motorcycles', 'homes', 'ltd', 'win', 'vip', 'work', 'life', 'today', 'world', 'space', 'pw', 'tk', 'ml', 'ga',
  'cf', 'gq', 'zip', 'mov', 'country', 'stream', 'download', 'racing', 'review', 'loan', 'date', 'faith', 'party', 'science',
]);

/** FNV-1a 32 bits sur les codes UTF-16 (les hôtes sont en ASCII). */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let e = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    e -= p * Math.log2(p);
  }
  return e;
}

/**
 * Vecteur creux : indices des trigrammes présents (valeur 1) et valeurs numériques.
 * L'hôte doit être en ASCII minuscule, sans « www. ».
 */
export function extractFeatures(host: string): { ngrams: number[]; numeric: number[] } {
  const s = `^${host}$`;
  const seen = new Set<number>();
  for (let i = 0; i + 3 <= s.length; i++) seen.add(fnv1a32(s.slice(i, i + 3)) % NGRAM_BUCKETS);
  const labels = host.split('.');
  const tld = labels[labels.length - 1] ?? '';
  const letters = host.replace(/[^a-z]/g, '');
  const vowels = letters.replace(/[^aeiouy]/g, '').length;
  const digits = host.replace(/[^0-9]/g, '').length;
  const hyphens = host.split('-').length - 1;
  const maxLabel = Math.max(...labels.map((l) => l.length));
  const numeric = [
    Math.min(host.length, 100) / 50,
    Math.min(hyphens, 10) / 5,
    host.length ? digits / host.length : 0,
    Math.min(labels.length, 10) / 5,
    entropy(host) / 5,
    letters.length ? vowels / letters.length : 0,
    Math.min(maxLabel, 63) / 30,
    RISKY_TLDS.has(tld) ? 1 : 0,
    /^[0-9.]+$/.test(host) ? 1 : 0,
  ];
  return { ngrams: [...seen].sort((a, b) => a - b), numeric };
}
