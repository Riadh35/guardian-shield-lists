/** Outils de comparaison de chaînes : distance d'édition, squelette visuel, écritures. */

/**
 * Distance de Damerau-Levenshtein restreinte (OSA) : insertions, suppressions,
 * substitutions et inversions de deux lettres voisines (« ameil » pour « ameli »).
 * S'arrête dès que la distance dépasse `max` (performance).
 */
export function osaDistance(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prevPrev = new Array<number>(lb + 1).fill(0);
  let prev = Array.from({ length: lb + 1 }, (_, j) => j);
  let cur = new Array<number>(lb + 1).fill(0);
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prevPrev[j - 2]! + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    [prevPrev, prev, cur] = [prev, cur, prevPrev];
  }
  return prev[lb]!;
}

/**
 * Caractères qui ressemblent à des lettres latines (cyrillique, grec, chiffres).
 * Liste volontairement courte et ciblée sur les noms de marques françaises.
 */
const CONFUSABLES: Record<string, string> = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ј: 'j', ѕ: 's', ԁ: 'd', ɡ: 'g', һ: 'h', ӏ: 'l', ԛ: 'q', ԝ: 'w', ν: 'v', ο: 'o', ρ: 'p', α: 'a', ε: 'e', ι: 'i', κ: 'k', τ: 't', υ: 'u',
  à: 'a', â: 'a', ä: 'a', á: 'a', é: 'e', è: 'e', ê: 'e', ë: 'e', î: 'i', ï: 'i', í: 'i', ô: 'o', ö: 'o', ó: 'o', ù: 'u', û: 'u', ü: 'u', ú: 'u', ç: 'c', ñ: 'n',
  '0': 'o', '1': 'l', '3': 'e', '5': 's', '@': 'a',
};

/** Squelette visuel : « amel1-fr » → « ameli-fr », « рaypal » (р cyrillique) → « paypal ». */
export function skeleton(s: string): string {
  let out = '';
  for (const ch of s.toLowerCase()) out += CONFUSABLES[ch] ?? ch;
  return out.replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/cl/g, 'd');
}

/** L'hôte mélange-t-il des écritures (latin + cyrillique ou grec) ? */
export function hasMixedScripts(s: string): boolean {
  const latin = /[a-z]/i.test(s);
  const cyrillic = /[Ѐ-ӿ]/.test(s);
  const greek = /[Ͱ-Ͽ]/.test(s);
  return (latin && (cyrillic || greek)) || (cyrillic && greek);
}

/** Contient des caractères hors ASCII (hors accents français usuels). */
export function hasNonLatin(s: string): boolean {
  return /[^\u0000-ɏ]/.test(s);
}

/** Normalise un texte pour la recherche de phrases : minuscules, sans accents, espaces simples. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ');
}
