/** Types publics du moteur de détection Guardian Wall. */

export type Verdict = 'safe' | 'caution' | 'danger';

/** Identifiant stable de chaque signal : sert aux tests, aux statistiques et aux textes. */
export type SignalId =
  | 'official'
  | 'blocklist_domain'
  | 'blocklist_url'
  | 'community_report'
  | 'brand_lookalike'
  | 'brand_same_name_other_tld'
  | 'brand_in_subdomain'
  | 'fake_gov'
  | 'brand_keyword'
  | 'brand_keyword_weak'
  | 'brand_keyword_path'
  | 'scam_words_in_domain'
  | 'homograph_mixed_script'
  | 'homograph_skeleton'
  | 'punycode'
  | 'risky_tld'
  | 'ip_host'
  | 'many_hyphens'
  | 'long_host'
  | 'many_digits'
  | 'deep_subdomain'
  | 'at_sign'
  | 'suspicious_path'
  | 'url_shortener'
  | 'free_hosting'
  | 'young_domain'
  | 'ml_lexical'
  | 'page_brand_impersonation'
  | 'page_fake_login'
  | 'page_card_form'
  | 'page_urgency'
  | 'page_tech_support'
  | 'page_foreign_form'
  // Raisons positives, affichées pour un site sûr.
  | 'popular_site'
  | 'https'
  | 'no_threat'
  | 'local_network';

export interface Signal {
  id: SignalId;
  /** Contribution au risque, entre 0 et 1 (probabilité indépendante combinée). */
  weight: number;
  /** Paramètres pour le texte affiché (marque imitée, vrai site…). */
  params?: Record<string, string>;
}

export interface Reason {
  id: SignalId;
  /** Phrase courte, en français simple, pour la popup et l'interstitiel. */
  text: string;
}

export interface AnalysisResult {
  url: string;
  host: string;
  /** Domaine enregistrable (eTLD+1), en Unicode. */
  domain: string;
  score: number;
  verdict: Verdict;
  /** Trois raisons au maximum, de la plus forte à la plus faible. */
  reasons: Reason[];
  /** Le vrai site, quand une marque est imitée. */
  officialAlternative?: string;
  signals: Signal[];
  /** Le moteur n'est pas sûr : une vérification en ligne serait utile (Phase 5). */
  uncertain: boolean;
  durationMs: number;
}

/** Contexte facultatif fourni par l'extension (couches en ligne, préférences). */
export interface AnalysisContext {
  /** Âge du domaine en jours, si connu (RDAP, Phase 5). */
  domainAgeDays?: number;
  /** Caractéristiques de la page, extraites par le content script. */
  page?: PageFeatures;
}

/** Ce que le content script extrait de la page, sans jamais l'envoyer ailleurs. */
export interface PageFeatures {
  title?: string;
  siteName?: string;
  /** Premiers caractères du texte visible (2 000 au maximum). */
  text?: string;
  hasPasswordField?: boolean;
  hasCardField?: boolean;
  hasIbanField?: boolean;
  /** Hôtes vers lesquels les formulaires de la page envoient leurs données. */
  formActionHosts?: string[];
  isHttps?: boolean;
}
