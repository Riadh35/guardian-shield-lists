/**
 * Modèle embarqué : régression logistique sur trigrammes de caractères et indices numériques.
 * Entraîné hors ligne (tools/ml/train.py) sur Phishing.Database (MIT) et les sites populaires
 * du Chrome UX Report. Aucune donnée ne sort de l'ordinateur : l'inférence est locale.
 */
import { extractFeatures, NGRAM_BUCKETS, NUMERIC_FEATURES } from './features.ts';

export interface LexicalModel {
  version: string;
  bias: number;
  /** Poids des trigrammes (NGRAM_BUCKETS valeurs). */
  ngram: number[];
  /** Poids des valeurs numériques (NUMERIC_FEATURES valeurs). */
  numeric: number[];
  /** Mesures sur l'échantillon de test, pour le rapport. */
  metrics?: Record<string, number>;
}

export function validateModel(m: LexicalModel): LexicalModel {
  if (m.ngram.length !== NGRAM_BUCKETS || m.numeric.length !== NUMERIC_FEATURES) {
    throw new Error('Modèle lexical incompatible avec les caractéristiques');
  }
  return m;
}

/** Probabilité (0 à 1) que l'hôte soit un site de phishing, d'après sa seule forme. */
export function predictPhishing(model: LexicalModel, host: string): number {
  const { ngrams, numeric } = extractFeatures(host);
  let z = model.bias;
  for (const i of ngrams) z += model.ngram[i]!;
  for (let i = 0; i < numeric.length; i++) z += model.numeric[i]! * numeric[i]!;
  return 1 / (1 + Math.exp(-z));
}
