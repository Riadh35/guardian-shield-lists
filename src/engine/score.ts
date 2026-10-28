/**
 * Combinaison des indices en un score de 0 (dangereux) à 100 (sûr), explicable.
 * Chaque indice est traité comme une probabilité indépendante de danger :
 *   risque = 1 − Π(1 − poids)    score = 100 × (1 − risque)
 * Les seuils de verdict viennent du design system (75 et 40).
 */
import type { Reason, Signal, Verdict } from './types.ts';
import { reasonText } from './reasons.ts';

export const THRESHOLDS = { safeMin: 75, cautionMin: 40 } as const;

/** Indices « structurels » faibles : jamais affichés comme raison principale s'il y a mieux. */
const MINOR: ReadonlySet<Signal['id']> = new Set(['many_hyphens', 'long_host', 'many_digits', 'deep_subdomain', 'url_shortener', 'punycode']);

export function combine(signals: Signal[]): number {
  let keep = 1;
  for (const s of signals) keep *= 1 - Math.min(Math.max(s.weight, 0), 1);
  return 1 - keep;
}

export function scoreFromRisk(risk: number): number {
  return Math.round(100 * (1 - Math.min(Math.max(risk, 0), 1)));
}

export function verdictFromScore(score: number): Verdict {
  if (score >= THRESHOLDS.safeMin) return 'safe';
  if (score >= THRESHOLDS.cautionMin) return 'caution';
  return 'danger';
}

/** Trois raisons au maximum : les plus fortes, sans doublon de texte. */
export function topReasons(signals: Signal[], max = 3): Reason[] {
  const sorted = [...signals].sort((a, b) => {
    const ma = MINOR.has(a.id) ? 1 : 0;
    const mb = MINOR.has(b.id) ? 1 : 0;
    return ma - mb || b.weight - a.weight;
  });
  const out: Reason[] = [];
  const seen = new Set<string>();
  for (const s of sorted) {
    if (s.weight < 0.1 && out.length > 0) continue;
    const text = reasonText(s);
    if (seen.has(text)) continue;
    seen.add(text);
    out.push({ id: s.id, text });
    if (out.length === max) break;
  }
  return out;
}
