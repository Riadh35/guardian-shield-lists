/**
 * Indices tirés du contenu de la page (titre, texte, formulaires), extraits localement
 * par le content script. Rien n'est envoyé : l'analyse se fait dans le navigateur.
 */
import { BRANDS, type Brand } from '../brands.ts';
import { normalizeText } from '../text.ts';
import { registrableDomain, type ParsedUrl } from '../url.ts';
import type { PageFeatures, Signal } from '../types.ts';

export const PAGE_WEIGHTS = {
  page_brand_impersonation: 0.45,
  page_fake_login: 0.85,
  page_card_form: 0.3,
  page_urgency_one: 0.15,
  page_urgency_many: 0.35,
  page_tech_support: 0.75,
  page_foreign_form: 0.35,
} as const;

/** Formules typiques des arnaques françaises (texte normalisé : minuscules, sans accents). */
export const URGENCY_PHRASES: readonly string[] = [
  'votre compte sera suspendu', 'votre compte a ete suspendu', 'compte bloque', 'compte suspendu', 'colis en attente',
  'votre colis est en attente', 'frais de livraison', 'frais de reexpedition', 'frais de douane', 'vous avez droit a un remboursement',
  'remboursement en attente', 'dernier avis', 'derniere relance', 'sous 24 h', 'sous 24h', 'sous 48 h', 'sous 48h', 'action requise',
  'mettre a jour vos informations', 'mettez a jour vos informations', 'mise a jour de vos coordonnees', 'carte vitale expire',
  'votre carte vitale', 'amende impayee', 'avis de contravention', 'majoration', 'paiement refuse', 'paiement echoue',
  'confirmez votre identite', 'verifiez votre identite', 'activite inhabituelle', 'connexion inhabituelle', 'dossier incomplet',
  'votre abonnement a expire', 'votre abonnement est suspendu', 'cpf', 'droits a la formation', 'vous avez gagne', 'felicitations',
];

const TECH_SUPPORT_PHRASES: readonly string[] = [
  'votre ordinateur est infecte', 'votre ordinateur a ete bloque', 'virus detecte', 'appelez immediatement', 'appelez le support',
  'support technique microsoft', 'windows defender', 'ne fermez pas cette page', 'ne pas eteindre', 'cle de licence expiree',
  'your computer is infected', 'call microsoft support', 'do not close this window',
];

const PHONE = /(?:\+33|0)\s?[1-9](?:[\s.-]?\d{2}){4}|\b0[89]\d{2}[\s.]?\d{2}[\s.]?\d{2}[\s.]?\d{2}\b/;

/** Noms de marques recherchés dans les titres, compilés une fois. */
const HEADLINE_PATTERNS = BRANDS.flatMap((b) =>
  b.pageNames
    .map((name) => normalizeText(name))
    .filter((n) => n.length >= 4)
    .map((n) => ({ brand: b, re: new RegExp(`(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`) })),
);

/** Marque mise en avant dans le titre ou le nom du site (pas dans le texte courant, trop bavard). */
function brandInHeadline(f: PageFeatures): Brand | null {
  const head = normalizeText(`${f.title ?? ''} ${f.siteName ?? ''}`);
  if (!head.trim()) return null;
  return HEADLINE_PATTERNS.find(({ re }) => re.test(head))?.brand ?? null;
}

export function pageSignals(p: ParsedUrl, f: PageFeatures | undefined, isPopular: boolean): Signal[] {
  if (!f) return [];
  const out: Signal[] = [];
  const text = normalizeText(`${f.title ?? ''} ${f.text ?? ''}`).slice(0, 4000);

  // 1. La page se présente comme une marque officielle sur un domaine qui n'est pas le sien.
  const brand = isPopular ? null : brandInHeadline(f);
  const asksSecrets = f.hasPasswordField === true || f.hasCardField === true || f.hasIbanField === true;
  if (brand) {
    const params = { brand: brand.appellation, name: brand.nom, official: brand.primaryDomain };
    if (asksSecrets) out.push({ id: 'page_fake_login', weight: PAGE_WEIGHTS.page_fake_login, params });
    else out.push({ id: 'page_brand_impersonation', weight: PAGE_WEIGHTS.page_brand_impersonation, params });
  }

  // 2. Formulaire de carte bancaire sur un site inconnu.
  if (!isPopular && (f.hasCardField || f.hasIbanField) && !brand) {
    out.push({ id: 'page_card_form', weight: PAGE_WEIGHTS.page_card_form });
  }

  // 3. Formulaire qui envoie un mot de passe vers un autre site.
  if (f.hasPasswordField && f.formActionHosts?.length) {
    const foreign = f.formActionHosts.find((h) => registrableDomain(h) !== p.domain);
    if (foreign) out.push({ id: 'page_foreign_form', weight: PAGE_WEIGHTS.page_foreign_form, params: { target: foreign } });
  }

  // 4. Formules d'urgence typiques.
  const urgency = URGENCY_PHRASES.filter((ph) => text.includes(ph)).length;
  if (urgency >= 2) out.push({ id: 'page_urgency', weight: PAGE_WEIGHTS.page_urgency_many });
  else if (urgency === 1 && !isPopular) out.push({ id: 'page_urgency', weight: PAGE_WEIGHTS.page_urgency_one });

  // 5. Faux support technique : alerte virus + numéro de téléphone.
  const tech = TECH_SUPPORT_PHRASES.filter((ph) => text.includes(ph)).length;
  if (tech >= 2 || (tech >= 1 && PHONE.test(f.text ?? ''))) {
    out.push({ id: 'page_tech_support', weight: PAGE_WEIGHTS.page_tech_support });
  }

  return out;
}
