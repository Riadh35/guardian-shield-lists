/**
 * Moteur de détection Guardian Wall — point d'entrée.
 *
 * Couches (de la plus sûre à la plus incertaine) :
 *   1. Liste blanche des sites officiels français → sûr immédiatement.
 *   2. Listes de menaces locales (domaines et adresses) → dangereux immédiatement.
 *   3. Indices de l'adresse (imitation de marque, homographes, extension…).
 *   4. Modèle lexical embarqué (forme de l'adresse).
 *   5. Indices de la page (formulaires, texte d'urgence), si fournis.
 * Les sites très populaires voient leurs indices faibles atténués pour éviter les faux positifs.
 * Tout est local : aucune adresse n'est envoyée.
 */
import { brandOfOfficial, isOfficial } from './brands.ts';
import { pageSignals } from './heuristics/page-signals.ts';
import { urlSignals } from './heuristics/url-signals.ts';
import { emptyBundle, normalizeUrlKey, type ListBundle } from './lists.ts';
import { predictPhishing, type LexicalModel } from './ml/model.ts';
import { reasonText } from './reasons.ts';
import { combine, scoreFromRisk, topReasons, verdictFromScore } from './score.ts';
import type { AnalysisContext, AnalysisResult, Signal } from './types.ts';
import { parseUrl } from './url.ts';

export * from './types.ts';
export { parseUrl } from './url.ts';
export { CompactSet, ListKind, verifyListSignature, type ListBundle } from './lists.ts';

/** Indices qui restent pleinement valables même sur un site populaire. */
const STRONG_ON_POPULAR: ReadonlySet<Signal['id']> = new Set([
  'blocklist_url', 'homograph_mixed_script', 'homograph_skeleton', 'brand_in_subdomain', 'page_tech_support', 'page_foreign_form',
]);

/** Atténuation des autres indices sur un site populaire (top 100 000 du Chrome UX Report). */
const POPULAR_DAMPING = 0.25;

export interface EngineOptions {
  lists?: ListBundle;
  model?: LexicalModel;
  /** Seuil de probabilité du modèle à partir duquel il devient un indice. */
  mlThreshold?: number;
}

export class DetectionEngine {
  private lists: ListBundle;
  private model: LexicalModel | undefined;
  private readonly mlThreshold: number;

  constructor(opts: EngineOptions = {}) {
    this.lists = opts.lists ?? emptyBundle();
    this.model = opts.model;
    this.mlThreshold = opts.mlThreshold ?? 0.9;
  }

  setLists(lists: ListBundle): void {
    this.lists = lists;
  }

  setModel(model: LexicalModel | undefined): void {
    this.model = model;
  }

  analyze(url: string, ctx: AnalysisContext = {}): AnalysisResult | null {
    const t0 = now();
    const p = parseUrl(url);
    if (!p) return null;

    const base = { url: p.href, host: p.hostUnicode, domain: p.domain };

    // Réseau local (box, imprimante) : rien à analyser.
    if (p.isLocal) {
      const signals: Signal[] = [{ id: 'local_network', weight: 0 }];
      return { ...base, score: 100, verdict: 'safe', reasons: topReasons(signals), signals, uncertain: false, durationMs: now() - t0 };
    }

    // Couche 1 : site officiel.
    if (isOfficial(p) && !this.lists.dangerousUrls.has(normalizeUrlKey(p.host, p.path))) {
      const brand = brandOfOfficial(p.domain);
      const signals: Signal[] = [{ id: 'official', weight: 0, ...(brand ? { params: { brand: brand.appellation } } : {}) }];
      return { ...base, score: 98, verdict: 'safe', reasons: topReasons(signals), signals, uncertain: false, durationMs: now() - t0 };
    }

    const signals: Signal[] = [];

    // Couche 2 : listes de menaces.
    const listedDomain = this.lists.dangerousDomains.hasHostOrParent(p.host, p.domain);
    if (listedDomain) signals.push({ id: 'blocklist_domain', weight: 0.97 });
    if (this.lists.dangerousUrls.has(normalizeUrlKey(p.host, p.path))) signals.push({ id: 'blocklist_url', weight: 0.97 });
    if (this.lists.community?.hasHostOrParent(p.host, p.domain)) signals.push({ id: 'community_report', weight: 0.85 });

    const popular = this.lists.popularDomains.has(p.domain);

    // Couche 3 : indices de l'adresse.
    signals.push(...urlSignals(p, ctx.domainAgeDays === undefined ? {} : { domainAgeDays: ctx.domainAgeDays }));

    // Couche 4 : modèle lexical.
    if (this.model && !p.isIp) {
      const prob = predictPhishing(this.model, p.host);
      if (prob >= this.mlThreshold) {
        signals.push({ id: 'ml_lexical', weight: Math.min(0.5, (prob - this.mlThreshold) / (1 - this.mlThreshold) * 0.5 + 0.15), params: { p: prob.toFixed(2) } });
      }
    }

    // Couche 5 : indices de la page.
    signals.push(...pageSignals(p, ctx.page, popular));

    // Atténuation sur les sites populaires (sauf listes et indices forts).
    const effective = popular
      ? signals.map((s) => (s.id.startsWith('blocklist') || STRONG_ON_POPULAR.has(s.id) ? s : { ...s, weight: s.weight * POPULAR_DAMPING }))
      : signals;

    const risk = combine(effective);
    const score = scoreFromRisk(risk);
    const verdict = verdictFromScore(score);
    const alt = effective.find((s) => s.params?.official)?.params?.official;
    const uncertain = verdict === 'caution' || (verdict === 'safe' && score < 85 && !popular);

    return {
      ...base,
      score,
      verdict,
      reasons: verdict === 'safe' ? safeReasons(popular, p.protocol === 'https:') : topReasons(effective),
      ...(alt && verdict !== 'safe' ? { officialAlternative: alt } : {}),
      signals: effective,
      uncertain,
      durationMs: now() - t0,
    };
  }
}

function safeReasons(popular: boolean, https: boolean): AnalysisResult['reasons'] {
  const ids: Signal[] = [];
  if (popular) ids.push({ id: 'popular_site', weight: 0 });
  if (https) ids.push({ id: 'https', weight: 0 });
  ids.push({ id: 'no_threat', weight: 0 });
  return ids.map((s) => ({ id: s.id, text: reasonText(s) }));
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
