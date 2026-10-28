/**
 * Liste blanche des sites officiels français et index des marques imitées.
 * Source : src/engine/data/domaines-officiels-fr.json (Phase 0).
 */
import data from './data/domaines-officiels-fr.json' with { type: 'json' };
import { parse } from 'tldts';
import type { ParsedUrl } from './url.ts';
import { userContentPlatformOf } from './platforms.ts';

export type BrandCategory =
  | 'administration'
  | 'colis'
  | 'energie'
  | 'banque'
  | 'paiement'
  | 'operateur'
  | 'commerce'
  | 'service'
  | 'transport';

export interface Brand {
  id: string;
  nom: string;
  /** Façon de nommer la marque dans une phrase : « Imite le site des impôts ». */
  appellation: string;
  categorie: BrandCategory;
  domaines: string[];
  /** Le vrai site à proposer à l'utilisateur. */
  primaryDomain: string;
  /** Libellés des domaines officiels sans extension : « ameli », « impots », « credit-agricole ». */
  labels: string[];
  /** Mots-clés distinctifs : leur présence dans un domaine étranger est suspecte. */
  strongKeywords: string[];
  /** Mots-clés courants (« free », « orange », « colis ») : indice faible, jamais suffisant seul. */
  weakKeywords: string[];
  /** Expressions qui désignent la marque dans le texte d'une page. */
  pageNames: string[];
}

/** Marques à portée surtout française : un même nom sous une autre extension est très suspect. */
const FRENCH_ONLY: ReadonlySet<BrandCategory> = new Set(['administration', 'banque']);

const APPELLATIONS: Record<string, string> = {
  impots: 'le site des impôts',
  caf: 'le site de la CAF',
  ameli: "le site de l'Assurance Maladie (Ameli)",
  'service-public': 'Service-Public.fr',
  ants: "le site de l'ANTS",
  'france-travail': 'le site de France Travail',
  antai: 'le site des amendes (ANTAI)',
  critair: 'le site officiel Crit’Air',
  cpf: 'Mon Compte Formation',
  franceconnect: 'FranceConnect',
  urssaf: "le site de l'Urssaf",
  retraite: "le site de l'Assurance retraite",
  laposte: 'La Poste',
  'banque-postale': 'La Banque Postale',
  'credit-agricole': 'le Crédit Agricole',
  'caisse-epargne': "la Caisse d'Épargne",
  'credit-mutuel': 'le Crédit Mutuel',
  'banque-de-france': 'la Banque de France',
  'meta': 'Facebook, Instagram ou WhatsApp',
};

/** Mots du quotidien : ne suffisent jamais à accuser un site. */
const COMMON_WORDS: ReadonlySet<string> = new Set([
  'free', 'orange', 'ups', 'pv', 'prime', 'meta', 'apple', 'sosh', 'lbc', 'sg-', 'ca-', 'amende', 'amendes', 'contravention',
  'vignette', 'permis', 'passeport', 'retraite', 'electricite', 'peage', 'autoroute', 'allocations', 'allocation-familiale',
  'vitale', 'carte-grise', 'immatriculation', 'suivi-colis', 'compte-formation', 'impot', 'ants', 'msa',
  'carsat', 'cnav', 'outlook', 'office365', 'hotmail', 'gmail', 'ouigo', 'google', 'microsoft', 'amazon', 'facebook', 'instagram', 'whatsapp',
]);

/** Domaines officiels supplémentaires (institutions), en plus du fichier JSON. */
const EXTRA_OFFICIAL = ['gouvernement.fr', 'elysee.fr', 'assemblee-nationale.fr', 'senat.fr', 'cybermalveillance.gouv.fr', 'impots.gouv.fr'];

/**
 * Suffixes entièrement officiels : tout sous-domaine est un site public.
 * On y ajoute les administrations francophones en « gouv » (Québec, outre-mer, Afrique, Monaco),
 * pour ne pas les prendre pour de faux sites de l'État.
 */
const OFFICIAL_SUFFIXES: string[] = [
  ...data.suffixesOfficiels, 'gouv.fr', 'gouv.nc', 'gouv.pf', 'gouv.qc.ca', 'gouv.mc', 'gouv.ci', 'gouv.sn', 'gouv.bj',
  'gouv.ml', 'gouv.ht', 'gouv.cd', 'gouv.cg', 'gouv.ga', 'gouv.cm', 'gouv.tg', 'gouv.bf', 'gouv.ne', 'gouv.td', 'gouv.km',
  'gouv.mr', 'gouv.gn', 'gouv.dj', 'gouv.cf', 'gouv.mg', 'gouvernement.lu', 'public.lu',
];

function labelOf(domain: string): string {
  const p = parse(domain, { allowPrivateDomains: false });
  return p.domainWithoutSuffix ?? domain;
}

function buildBrands(): Brand[] {
  return data.marques.map((m) => {
    const strong: string[] = [];
    const weak: string[] = [];
    for (const raw of m.motsCles) {
      const k = raw.toLowerCase().replace(/-$/, '');
      if (k.length < 3) continue;
      (COMMON_WORDS.has(raw) || COMMON_WORDS.has(k) ? weak : strong).push(k);
    }
    const labels = [...new Set(m.domaines.filter((d) => d.includes('.')).map(labelOf))];
    const pageNames = [m.nom.toLowerCase(), ...strong.filter((k) => k.length >= 5)];
    return {
      id: m.id,
      nom: m.nom,
      appellation: APPELLATIONS[m.id] ?? m.nom,
      categorie: m.categorie as BrandCategory,
      domaines: m.domaines,
      primaryDomain: m.domaines[0] ?? '',
      labels,
      strongKeywords: [...new Set(strong)],
      weakKeywords: [...new Set(weak)],
      pageNames: [...new Set(pageNames)],
    };
  });
}

export const BRANDS: readonly Brand[] = buildBrands();

const officialExact = new Set<string>(EXTRA_OFFICIAL);
const officialTlds = new Set<string>();
const domainToBrand = new Map<string, Brand>();
for (const b of BRANDS) {
  for (const d of b.domaines) {
    if (d.includes('.')) {
      officialExact.add(d);
      domainToBrand.set(d, b);
    } else {
      officialTlds.add(d); // ex. « bnpparibas » : extension de marque
    }
  }
}

/** Le site appartient-il à une administration ou à une marque officielle ? */
export function isOfficial(p: Pick<ParsedUrl, 'host' | 'domain' | 'suffix'>): boolean {
  // Les espaces où n'importe qui publie (sites.google.com, forms.office.com…) ne sont jamais officiels.
  if (userContentPlatformOf(p.host, p.domain)) return false;
  if (officialExact.has(p.domain) || officialExact.has(p.host)) return true;
  for (const d of officialExact) if (p.host.endsWith(`.${d}`)) return true;
  if (officialTlds.has(p.suffix)) return true;
  return OFFICIAL_SUFFIXES.some((s) => p.host === s || p.host.endsWith(`.${s}`));
}

/** Marque à laquelle appartient un domaine officiel (pour l'affichage). */
export function brandOfOfficial(domain: string): Brand | undefined {
  return domainToBrand.get(domain);
}

/** Mot du quotidien (« free », « orange ») : jamais suffisant seul pour accuser un site. */
export function isCommonWord(w: string): boolean {
  return COMMON_WORDS.has(w);
}

export function isFrenchOnly(b: Brand): boolean {
  return FRENCH_ONLY.has(b.categorie);
}

/** Tous les libellés officiels, pour la recherche de typosquatting. */
export const OFFICIAL_LABELS: ReadonlyArray<{ label: string; brand: Brand }> = BRANDS.flatMap((b) =>
  b.labels.filter((l) => l.length >= 4).map((label) => ({ label, brand: b })),
);
