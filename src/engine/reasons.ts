/**
 * Textes des raisons, en français simple, vouvoiement, sans jargon (voir docs/design).
 * Une raison doit tenir sur une ligne de la popup (environ 40 caractères) quand c'est possible.
 */
import type { Signal, SignalId } from './types.ts';

type Template = (p: Record<string, string>) => string;

const TEXTS: Record<SignalId, Template> = {
  official: () => 'Site officiel vérifié',
  blocklist_domain: () => 'Site connu pour des arnaques',
  blocklist_url: () => 'Page connue pour des arnaques',
  community_report: () => 'Signalé par des utilisateurs',
  brand_lookalike: (p) => `Imite ${p.brand ?? 'un site connu'}`,
  brand_same_name_other_tld: (p) => `Imite ${p.brand ?? 'un site connu'}`,
  brand_in_subdomain: (p) => `Se fait passer pour ${p.official ?? 'un site officiel'}`,
  fake_gov: () => "Se fait passer pour un site de l'État",
  brand_keyword: (p) => `Reprend le nom « ${p.name ?? 'une marque'} » sans être le site officiel`,
  brand_keyword_weak: (p) => `Reprend un nom proche de « ${p.name ?? 'une marque'} »`,
  brand_keyword_path: (p) => `Cite « ${p.name ?? 'une marque'} » sur un site sans rapport`,
  scam_words_in_domain: () => "Adresse avec des mots d'arnaque courants",
  homograph_mixed_script: () => 'Adresse écrite avec des lettres trompeuses',
  homograph_skeleton: (p) => `Imite ${p.brand ?? 'un site connu'} avec des lettres trompeuses`,
  punycode: () => 'Adresse avec des caractères inhabituels',
  risky_tld: (p) => `Extension souvent utilisée par les arnaques (${p.tld ?? ''})`,
  ip_host: () => 'Adresse numérique au lieu d’un nom de site',
  many_hyphens: () => 'Adresse anormalement découpée',
  long_host: () => 'Adresse anormalement longue',
  many_digits: () => 'Adresse remplie de chiffres',
  deep_subdomain: () => 'Adresse à rallonge pour cacher le vrai site',
  at_sign: () => 'Adresse qui cache sa vraie destination',
  suspicious_path: () => 'Page de connexion ou de paiement suspecte',
  url_shortener: () => 'Lien raccourci : destination cachée',
  free_hosting: () => 'Site gratuit créé par un inconnu',
  young_domain: (p) => `Site créé il y a ${p.days ?? 'peu de'} jours`,
  ml_lexical: () => 'Adresse qui ressemble à celles des arnaques',
  page_brand_impersonation: (p) => `Se présente comme ${p.brand ?? 'un site officiel'}, mais ce n’est pas le vrai site`,
  page_fake_login: (p) => `Faux formulaire imitant ${p.brand ?? 'un site officiel'}`,
  page_card_form: () => 'Demande votre carte bancaire sur un site inconnu',
  page_urgency: () => 'Vous presse avec un message d’urgence',
  page_tech_support: () => 'Fausse alerte virus avec numéro à appeler',
  page_foreign_form: () => 'Envoie votre mot de passe vers un autre site',
  popular_site: () => 'Site très fréquenté, sans signalement',
  https: () => 'Connexion chiffrée',
  no_threat: () => 'Aucun signe d’arnaque détecté',
  local_network: () => 'Appareil de votre réseau local (box, imprimante…)',
};

export function reasonText(s: Signal): string {
  return TEXTS[s.id](s.params ?? {});
}
