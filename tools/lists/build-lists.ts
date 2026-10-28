/**
 * Construction des listes de menaces distribuées à l'extension (ADR-0002, ADR-0004).
 * Prévu pour tourner toutes les heures dans GitHub Actions (dépôt public guardian-shield-lists).
 *
 * Usage :
 *   node --experimental-strip-types tools/lists/build-lists.ts [--out dist-lists] [--cache .work]
 * Variables d'environnement :
 *   GW_LIST_SIGNING_KEY  clé privée Ed25519 (PKCS8, base64). Sans elle, les listes ne sont pas signées.
 *   GW_OFFLINE=1         utiliser uniquement les fichiers déjà présents dans le cache.
 *
 * Sources (licences vérifiées en Phase 0) :
 *   - Phishing.Database (MIT) : domaines et liens de phishing actifs.
 *   - Chrome UX Report, top 1M (CC BY 4.0) via github.com/zakird/crux-top-lists : sites populaires,
 *     utilisés pour ÉVITER les faux positifs (jamais pour bloquer).
 */
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { isOfficial } from '../../src/engine/brands.ts';
import { urlSignals } from '../../src/engine/heuristics/url-signals.ts';
import { CompactSet, ListKind, normalizeUrlKey } from '../../src/engine/lists.ts';
import { userContentPlatformOf } from '../../src/engine/platforms.ts';
import { parseUrl, registrableDomain } from '../../src/engine/url.ts';

const SOURCES = {
  pdbDomains: 'https://raw.githubusercontent.com/Phishing-Database/Phishing.Database/master/phishing-domains-ACTIVE.txt',
  pdbLinks: 'https://raw.githubusercontent.com/Phishing-Database/Phishing.Database/master/phishing-links-ACTIVE.txt',
  crux: 'https://raw.githubusercontent.com/zakird/crux-top-lists/main/data/global/current.csv.gz',
} as const;

/** Rang CrUX maximal pour qu'un domaine soit considéré « populaire ». */
const POPULAR_MAX_RANK = 100_000;
/**
 * Indices qui disqualifient un domaine populaire : uniquement les procédés d'attaque sans
 * usage légitime (lettres trompeuses, domaine officiel recopié en sous-domaine). Une simple
 * ressemblance de nom (creditoagricola.pt, impots.bj) est fréquente chez des sites légitimes
 * populaires : ceux-là restent populaires, et leurs indices sont seulement atténués.
 */
const IMPERSONATION = new Set(['brand_in_subdomain', 'homograph_skeleton', 'homograph_mixed_script']);

const args = process.argv.slice(2);
const argOf = (name: string, def: string): string => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1]! : def;
};
const OUT = argOf('--out', 'dist-lists');
const CACHE = argOf('--cache', '.work');

async function fetchCached(url: string, file: string): Promise<Buffer> {
  const path = join(CACHE, file);
  if (process.env.GW_OFFLINE === '1' && existsSync(path)) return readFileSync(path);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) throw new Error('fichier anormalement petit');
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(path, buf);
    return buf;
  } catch (err) {
    if (existsSync(path)) {
      console.warn(`! ${url} indisponible (${String(err)}), utilisation du cache`);
      return readFileSync(path);
    }
    throw new Error(`Source indisponible et pas de cache : ${url}`);
  }
}

const clean = (s: string): string => s.trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');

export interface BuildStats {
  popular: number;
  popularExcludedImpersonation: string[];
  dangerousDomains: number;
  droppedPopular: number;
  droppedOfficial: number;
  dangerousUrls: number;
}

export function buildFromRaw(pdbDomains: string, pdbLinks: string, cruxCsv: string): { sets: Record<string, CompactSet>; stats: BuildStats; popularSet: Set<string>; dangerousHosts: Set<string> } {
  // 1. Domaines populaires (registrables), hors plateformes à contenu utilisateur et hors imitations.
  const popularSet = new Set<string>();
  const excluded: string[] = [];
  for (const line of cruxCsv.split('\n').slice(1)) {
    const [origin, rank] = line.split(',');
    if (!origin || Number(rank) > POPULAR_MAX_RANK) continue;
    const host = clean(origin.replace(/^https?:\/\//, ''));
    const reg = registrableDomain(host);
    if (popularSet.has(reg) || userContentPlatformOf(host, reg)) continue;
    const p = parseUrl(`https://${reg}`);
    if (!p) continue;
    if (urlSignals(p, {}).some((s) => IMPERSONATION.has(s.id))) {
      excluded.push(reg);
      continue;
    }
    popularSet.add(reg);
  }

  // 2. Domaines dangereux : on retire les sites officiels et les sites populaires (sauf sous-domaines de plateformes).
  const dangerous = new Set<string>();
  let droppedPopular = 0;
  let droppedOfficial = 0;
  for (const raw of pdbDomains.split('\n')) {
    const host = clean(raw);
    if (!host || host.startsWith('#') || !host.includes('.')) continue;
    const p = parseUrl(`https://${host}`);
    if (!p || p.isLocal) continue;
    if (isOfficial(p)) {
      droppedOfficial++;
      continue;
    }
    const platform = userContentPlatformOf(p.host, p.domain);
    if (popularSet.has(p.domain) && !platform) {
      droppedPopular++;
      continue;
    }
    if (platform && p.host === platform) continue; // jamais la racine d'une plateforme
    dangerous.add(p.host);
  }

  // 3. Adresses dangereuses : uniquement sur les sites populaires ou les racines de plateformes,
  //    là où l'on ne peut pas bloquer tout le domaine.
  const urls = new Set<string>();
  for (const raw of pdbLinks.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('http')) continue;
    const p = parseUrl(line);
    if (!p || p.isLocal) continue;
    const platform = userContentPlatformOf(p.host, p.domain);
    const shared = popularSet.has(p.domain) || (platform !== null && p.host === platform) || isOfficial(p);
    if (!shared) continue;
    const key = normalizeUrlKey(p.host, new URL(p.href).pathname);
    if (key.split('/').length < 2 || key.endsWith('/')) continue;
    urls.add(key);
  }

  return {
    sets: {
      'dangerous-domains': CompactSet.fromEntries(ListKind.DangerousDomains, dangerous),
      'dangerous-urls': CompactSet.fromEntries(ListKind.DangerousUrls, urls),
      'popular-domains': CompactSet.fromEntries(ListKind.PopularDomains, popularSet),
    },
    stats: {
      popular: popularSet.size,
      popularExcludedImpersonation: [...new Set(excluded)],
      dangerousDomains: dangerous.size,
      droppedPopular,
      droppedOfficial,
      dangerousUrls: urls.size,
    },
    popularSet,
    dangerousHosts: dangerous,
  };
}

async function main(): Promise<void> {
  const [d, l, c] = await Promise.all([
    fetchCached(SOURCES.pdbDomains, 'pdb-domains.txt'),
    fetchCached(SOURCES.pdbLinks, 'pdb-links.txt'),
    fetchCached(SOURCES.crux, 'crux.csv.gz'),
  ]);
  const { sets, stats } = buildFromRaw(d.toString('utf8'), l.toString('utf8'), gunzipSync(c).toString('utf8'));
  mkdirSync(OUT, { recursive: true });
  const key = process.env.GW_LIST_SIGNING_KEY
    ? createPrivateKey({ key: Buffer.from(process.env.GW_LIST_SIGNING_KEY, 'base64'), format: 'der', type: 'pkcs8' })
    : null;
  const manifest: Record<string, unknown> = { version: 1, createdAt: new Date().toISOString(), signed: key !== null, files: {} };
  for (const [name, set] of Object.entries(sets)) {
    const bytes = set.serialize();
    writeFileSync(join(OUT, `${name}.gwl`), bytes);
    if (key) writeFileSync(join(OUT, `${name}.gwl.sig`), sign(null, bytes, key));
    (manifest.files as Record<string, unknown>)[name] = {
      entries: set.size,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ ...stats, popularExcludedImpersonation: stats.popularExcludedImpersonation.slice(0, 50) }, null, 2));
  if (!key) console.warn('! GW_LIST_SIGNING_KEY absente : listes NON signées (développement uniquement).');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
