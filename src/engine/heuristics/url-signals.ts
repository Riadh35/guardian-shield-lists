/**
 * Indices tirés de la seule adresse : imitation de marque, homographes, extension à risque…
 * Chaque indice a un poids entre 0 et 1 ; le score les combine (voir score.ts).
 */
import { BRANDS, OFFICIAL_LABELS, isCommonWord, isFrenchOnly, type Brand } from '../brands.ts';
import { RISKY_TLDS } from '../ml/features.ts';
import { URL_SHORTENERS, userContentPlatformOf } from '../platforms.ts';
import { hasMixedScripts, hasNonLatin, osaDistance, skeleton } from '../text.ts';
import { tokenize, type ParsedUrl } from '../url.ts';
import type { Signal } from '../types.ts';

/** Poids de chaque indice. Calibrés sur le banc de mesure (docs/phase2/rapport-moteur.md). */
export const WEIGHTS = {
  brand_lookalike: 0.85,
  // Même nom exact sur une autre extension : souvent un domaine défensif de la marque (urssaf.org,
  // bnpparibas.net). « Prudence » seulement ; les indices de la page font passer en « dangereux ».
  brand_same_name_other_tld_fr: 0.5,
  brand_in_subdomain: 0.9,
  fake_gov: 0.8,
  brand_keyword_fr: 0.58,
  brand_keyword: 0.65,
  brand_keyword_substring: 0.45,
  brand_keyword_weak: 0.12,
  brand_keyword_path: 0.2,
  scam_words_one: 0.18,
  scam_words_many: 0.35,
  homograph_mixed_script: 0.8,
  homograph_skeleton: 0.95,
  punycode: 0.25,
  risky_tld: 0.22,
  ip_host: 0.5,
  many_hyphens: 0.15,
  long_host: 0.1,
  many_digits: 0.1,
  deep_subdomain: 0.15,
  at_sign: 0.4,
  suspicious_path_one: 0.1,
  suspicious_path_many: 0.22,
  url_shortener: 0.1,
  free_hosting: 0.2,
  young_domain_30: 0.45,
  young_domain_90: 0.2,
} as const;

/**
 * Mots typiques des arnaques françaises dans un nom de domaine. Volontairement restreints :
 * « espace », « client », « service » ou « aide » sont trop courants sur les sites légitimes.
 */
const SCAM_WORDS: ReadonlySet<string> = new Set([
  'remboursement', 'rembourser', 'colis', 'livraison', 'amende', 'amendes', 'vitale', 'securite', 'securise',
  'verification', 'verifier', 'confirmation', 'confirmer', 'paiement', 'payement', 'payer', 'impaye', 'regularisation',
  'majoration', 'maj', 'update', 'secure', 'login', 'verify', 'identification', 'auth', 'billing', 'refund', 'parcel',
  'unlock', 'recovery', 'restore', 'validation', 'valider', 'actualisation', 'renouvellement', 'renouv', 'suspendu',
]);

/** Racines qui, collées à un nom de marque, trahissent une arnaque (« amelisupport », « monameli »). */
const COMPOUND_STEMS: readonly string[] = [
  'carte', 'vital', 'renouv', 'support', 'connect', 'compte', 'espace', 'service', 'secur', 'rembours', 'paiement',
  'payement', 'pay', 'info', 'assur', 'cpam', 'aide', 'client', 'verif', 'gouv', 'gov', 'fr', 'online', 'login',
  'maj', 'update', 'mon', 'mes', 'acces', 'portail', 'officiel', 'offical', 'official', 'remb', 'droit', 'dossier',
  'colis', 'suivi', 'livraison', 'frais', 'amende', 'impot', 'service', 'web', 'net', 'direct', 'mobile', 'app',
];

/** Plateformes où le contenu de l'utilisateur est dans le chemin, pas dans le sous-domaine. */
const PATH_PLATFORMS: ReadonlySet<string> = new Set(['sites.google.com', 'storage.googleapis.com', 'forms.office.com', 'docs.google.com']);

const PATH_WORDS = /(login|signin|sign-in|verify|verification|secure|update|confirm|account|webscr|auth|wp-admin\/.+\.php|paiement|payment|remboursement|colis|livraison|amende|carte|identifiant|connexion|billing|wallet|recovery)/g;

function brandMatchesToken(b: Brand, tokens: string[], joined: string): { kind: 'strong' | 'substring' | 'weak'; keyword: string } | null {
  for (const k of b.strongKeywords) {
    const kt = tokenize(k);
    // Mot-clé composé (« credit-agricole ») : on cherche la suite de mots ; sinon un mot exact.
    if (kt.length > 1 ? joined.includes(kt.join('-')) || joined.includes(kt.join('')) : tokens.includes(k)) {
      return { kind: 'strong', keyword: k };
    }
  }
  for (const k of b.strongKeywords) {
    if (k.length >= 6 && joined.replace(/-/g, '').includes(k.replace(/-/g, ''))) return { kind: 'substring', keyword: k };
  }
  for (const k of b.weakKeywords) if (tokens.includes(k)) return { kind: 'weak', keyword: k };
  return null;
}

/** Paires de lettres qui se confondent à l'œil (en plus des voyelles entre elles). */
const CONFUSABLE_PAIRS: ReadonlySet<string> = new Set(['il', 'li', 'l1', '1l', 'i1', '1i', 'o0', '0o', 'uv', 'vu', 'nm', 'mn', 'gq', 'qg', 's5', '5s', 'ce', 'ec', 'bd', 'db', 'ij', 'ji']);
const VOWELS = /^[aeiouy]$/;

/**
 * Faute de frappe volontaire ? On n'accepte que les erreurs typiques des arnaques :
 * lettre remplacée par une lettre qui lui ressemble (ou une voyelle par une autre), deux lettres
 * inversées, lettre doublée ou dédoublée. « lacoste » n'imite donc pas « laposte », ni « engine »
 * « engie », mais « amelli », « ameil » et « lcloud » (pour icloud) sont reconnus.
 * Pour les noms longs (12 lettres et plus), deux erreurs sont tolérées.
 */
export function isTypoOf(candidate: string, official: string): boolean {
  if (candidate === official) return false;
  if (official.length >= 12) return osaDistance(candidate, official, 2) <= 2;
  if (osaDistance(candidate, official, 1) !== 1) return false;
  if (candidate.length === official.length) {
    let diff = -1;
    for (let i = 0; i < candidate.length; i++) {
      if (candidate[i] !== official[i]) {
        if (diff >= 0) return true; // deux différences voisines à distance 1 : inversion
        diff = i;
      }
    }
    const a = candidate[diff]!;
    const b = official[diff]!;
    return CONFUSABLE_PAIRS.has(a + b) || (VOWELS.test(a) && VOWELS.test(b));
  }
  const [long, short] = candidate.length > official.length ? [candidate, official] : [official, candidate];
  for (let i = 0; i < long.length; i++) {
    if (long.slice(0, i) + long.slice(i + 1) === short) return (i > 0 && long[i] === long[i - 1]) || long[i] === long[i + 1] || long[i] === '-';
  }
  return false;
}

/** Domaines officiels recopiés dans un sous-domaine (« ameli.fr. », « ameli-fr. »), compilés une fois. */
const SUBDOMAIN_PATTERNS = BRANDS.map((brand) => ({
  brand,
  patterns: brand.domaines.filter((d) => d.includes('.')).map((d) => new RegExp(`(^|[.-])${d.replace(/[.]/g, '[.-]')}([.-]|$)`)),
}));

/** « amelisupport » → marque « ameli » collée à « support ». */
function compoundBrand(tokens: string[]): Brand | null {
  for (const t of tokens) {
    if (t.length < 7) continue;
    for (const b of BRANDS) {
      for (const k of [...b.strongKeywords, ...b.weakKeywords]) {
        const kk = k.replace(/-/g, '');
        if (kk.length < 4 || t === kk) continue;
        if (t.startsWith(kk) && COMPOUND_STEMS.some((st) => t.slice(kk.length).startsWith(st))) return b;
        if (t.endsWith(kk) && COMPOUND_STEMS.some((st) => t.slice(0, t.length - kk.length).endsWith(st))) return b;
      }
    }
  }
  return null;
}

/**
 * Extensions à enregistrement contrôlé (employeur, banque, État, université vérifiés) :
 * on n'y achète pas un nom de marque au hasard, donc pas d'indice « nom de marque ».
 */
const RESTRICTED_TLDS = new Set(['jobs', 'bank', 'insurance', 'gov', 'edu', 'mil', 'int']);
const RESTRICTED_SLD = /^(gov|gouv|edu|ac|mil|go|gob|govt|gv|gub)\./;

export function urlSignals(p: ParsedUrl, ctx: { domainAgeDays?: number }): Signal[] {
  const out: Signal[] = [];
  const add = (id: Signal['id'], weight: number, params?: Record<string, string>): void => {
    out.push(params ? { id, weight, params } : { id, weight });
  };

  if (p.isIp) add('ip_host', WEIGHTS.ip_host);
  if (p.hasUserInfo) add('at_sign', WEIGHTS.at_sign);

  const label = p.domainLabel.toLowerCase();
  const labelTokens = tokenize(label);
  const labelJoined = labelTokens.join('-');
  const subTokens = tokenize(p.subdomain);
  const tld = p.suffix.split('.').pop() ?? '';
  const restricted = RESTRICTED_TLDS.has(tld) || RESTRICTED_SLD.test(p.suffix);

  // 1. Homographes et punycode.
  if (p.host.includes('xn--')) {
    if (p.hostUnicode.split('.').some(hasMixedScripts)) add('homograph_mixed_script', WEIGHTS.homograph_mixed_script);
    else if (hasNonLatin(p.hostUnicode)) add('punycode', WEIGHTS.punycode); // les accents français ne comptent pas
    const sk = skeleton(p.hostUnicode.split('.').slice(0, -1).join('.'));
    const hit = OFFICIAL_LABELS.find(({ label: l }) => sk === l || sk.endsWith(`.${l}`) || sk.split('.').includes(l));
    if (hit) add('homograph_skeleton', WEIGHTS.homograph_skeleton, { brand: hit.brand.appellation, name: hit.brand.nom, official: hit.brand.primaryDomain });
  }

  // 2. Faux site de l'État : « gouv » dans un domaine qui n'est pas en .gouv.fr.
  const flat = label.replace(/-/g, '');
  if (/gouv(?!ern)/.test(flat)) add('fake_gov', WEIGHTS.fake_gov);
  else if (
    flat !== 'gov' &&
    (labelTokens.includes('gov') || (/gov$/.test(flat) && flat.length > 3)) &&
    (tld === 'fr' || RISKY_TLDS.has(tld) || labelTokens.some((t) => SCAM_WORDS.has(t) || BRANDS.some((b) => b.strongKeywords.includes(t))))
  ) {
    // « amendesgov.fr », « caf-gov.com » ; mais pas gov.uk, mygov.in, yougov.com (sites légitimes).
    add('fake_gov', WEIGHTS.fake_gov * 0.7);
  }

  // 3. Domaine officiel recopié dans le sous-domaine : « impots.gouv.fr.secure-login.xyz ».
  if (p.subdomain) {
    for (const { brand: b, patterns } of SUBDOMAIN_PATTERNS) {
      if (patterns.some((re) => re.test(p.subdomain))) {
        add('brand_in_subdomain', WEIGHTS.brand_in_subdomain, { brand: b.appellation, name: b.nom, official: b.primaryDomain });
        break;
      }
    }
    if (subTokens.some((t) => /gouv(?!ern)/.test(t)) && !out.some((s) => s.id === 'fake_gov')) add('fake_gov', WEIGHTS.fake_gov * 0.9);
  }

  // 4. Typosquatting : « ameIi », « amelli », « credit-agricol », même nom sous une autre extension.
  const sk = skeleton(label);
  let lookalike: Brand | null = null;
  // Domaine officiel hébergeant du contenu d'utilisateurs (sites.google.com) : ni officiel ni imitation.
  const ownDomain = restricted || BRANDS.some((b) => b.domaines.includes(p.domain));
  for (const { label: official, brand } of ownDomain ? [] : OFFICIAL_LABELS) {
    if (label === official) {
      // Même nom, autre extension (ameli.com au lieu de ameli.fr) : très suspect pour une marque
      // purement française. Les marques internationales (amazon.de, vinted.pl…) ont des sites
      // légitimes dans chaque pays : on ne conclut rien.
      if (isFrenchOnly(brand) && !isCommonWord(official)) {
        add('brand_same_name_other_tld', WEIGHTS.brand_same_name_other_tld_fr, { brand: brand.appellation, name: brand.nom, official: brand.primaryDomain });
      }
      lookalike = brand;
      break;
    }
    if (official.length < 5 || isCommonWord(official)) continue;
    if (isTypoOf(label, official) || (sk !== label && sk === official)) {
      add('brand_lookalike', WEIGHTS.brand_lookalike, { brand: brand.appellation, name: brand.nom, official: brand.primaryDomain });
      lookalike = brand;
      break;
    }
  }

  // 5. Nom de marque dans le domaine : « ameli-remboursement.fr », « caf-aide.info ».
  if (!lookalike && !ownDomain) {
    let bestKind: 'strong' | 'substring' | 'weak' | null = null;
    let bestBrand: Brand | null = null;
    for (const b of BRANDS) {
      const m = brandMatchesToken(b, labelTokens, labelJoined);
      if (!m) continue;
      const rank = { strong: 3, substring: 2, weak: 1 }[m.kind];
      const bestRank = bestKind ? { strong: 3, substring: 2, weak: 1 }[bestKind] : 0;
      if (rank > bestRank) {
        bestKind = m.kind;
        bestBrand = b;
      }
    }
    if (!bestBrand || bestKind === 'weak') {
      const comp = compoundBrand(labelTokens);
      if (comp) {
        bestBrand = comp;
        bestKind = 'substring';
      }
    }
    if (!bestBrand || bestKind === 'weak') {
      // Faute de frappe sur un mot du domaine ou du sous-domaine : « alert-lcloud », « account-bnppariabs ».
      for (const t of [...labelTokens, ...subTokens]) {
        const hit = OFFICIAL_LABELS.find(({ label: l }) => l.length >= 5 && !isCommonWord(l) && isTypoOf(t, l));
        if (hit) {
          bestBrand = hit.brand;
          bestKind = 'strong';
          break;
        }
      }
    }
    // Le domaine entier est exactement le nom de la marque (edf.com, sfr.com, dpd.ie) : même règle
    // que « même nom, autre extension » ci-dessus, et non un nom de marque glissé dans un domaine.
    if (bestBrand && bestKind === 'strong' && labelTokens.length === 1 && bestBrand.strongKeywords.includes(label)) {
      if (isFrenchOnly(bestBrand) && !isCommonWord(label)) {
        add('brand_same_name_other_tld', WEIGHTS.brand_same_name_other_tld_fr, { brand: bestBrand.appellation, name: bestBrand.nom, official: bestBrand.primaryDomain });
      }
      bestBrand = null;
      bestKind = null;
    }
    if (bestBrand && bestKind) {
      const params = { brand: bestBrand.appellation, name: bestBrand.nom, official: bestBrand.primaryDomain };
      // Les marques françaises ont leurs sites en .fr : leur nom sur un .com, .info ou .org est plus suspect.
      if (bestKind === 'strong') add('brand_keyword', tld === 'fr' ? WEIGHTS.brand_keyword_fr : WEIGHTS.brand_keyword, params);
      else if (bestKind === 'substring') add('brand_keyword', WEIGHTS.brand_keyword_substring, params);
      else add('brand_keyword_weak', WEIGHTS.brand_keyword_weak, params);
    } else if (subTokens.length) {
      // Marque dans le sous-domaine (« ameli-secure.exemple.com ») : indice moyen.
      for (const b of BRANDS) {
        const m = brandMatchesToken(b, subTokens, subTokens.join('-'));
        if (m && m.kind !== 'weak') {
          add('brand_keyword', WEIGHTS.brand_keyword_fr * 0.75, { brand: b.appellation, name: b.nom, official: b.primaryDomain });
          break;
        }
      }
    }
  }

  // 6. Marque citée dans le chemin d'un site sans rapport (« exemple.com/ameli/connexion »).
  if (!out.some((s) => s.id.startsWith('brand_'))) {
    const pathTokens = tokenize(p.path);
    for (const b of BRANDS) {
      if (b.strongKeywords.some((k) => k.length >= 5 && pathTokens.includes(k))) {
        add('brand_keyword_path', WEIGHTS.brand_keyword_path, { brand: b.appellation, name: b.nom, official: b.primaryDomain });
        break;
      }
    }
  }

  // 7. Mots d'arnaque dans le domaine.
  const scamCount = new Set(labelTokens.filter((t) => SCAM_WORDS.has(t))).size;
  if (scamCount >= 2) add('scam_words_in_domain', WEIGHTS.scam_words_many);
  else if (scamCount === 1) add('scam_words_in_domain', WEIGHTS.scam_words_one);

  // 8. Forme de l'adresse.
  if (!p.isIp && RISKY_TLDS.has(tld)) add('risky_tld', WEIGHTS.risky_tld, { tld: `.${tld}` });
  if ((label.match(/-/g) ?? []).length >= 3) add('many_hyphens', WEIGHTS.many_hyphens);
  if (p.host.length > 50) add('long_host', WEIGHTS.long_host);
  if ((label.match(/[0-9]/g) ?? []).length >= 4) add('many_digits', WEIGHTS.many_digits);
  if (p.subdomain.split('.').filter(Boolean).length >= 4) add('deep_subdomain', WEIGHTS.deep_subdomain);
  const pathHits = new Set(p.path.match(PATH_WORDS) ?? []).size;
  if (pathHits >= 2) add('suspicious_path', WEIGHTS.suspicious_path_many);
  else if (pathHits === 1) add('suspicious_path', WEIGHTS.suspicious_path_one);

  // 9. Plateformes : raccourcisseurs, hébergement gratuit.
  if (URL_SHORTENERS.has(p.domain) || URL_SHORTENERS.has(p.host)) add('url_shortener', WEIGHTS.url_shortener);
  const platform = userContentPlatformOf(p.host, p.domain);
  if (platform && (p.host !== platform || PATH_PLATFORMS.has(platform))) add('free_hosting', WEIGHTS.free_hosting, { platform });

  // 10. Âge du domaine (si connu).
  if (ctx.domainAgeDays !== undefined) {
    const days = String(ctx.domainAgeDays);
    if (ctx.domainAgeDays < 30) add('young_domain', WEIGHTS.young_domain_30, { days });
    else if (ctx.domainAgeDays < 90) add('young_domain', WEIGHTS.young_domain_90, { days });
  }

  return out;
}
