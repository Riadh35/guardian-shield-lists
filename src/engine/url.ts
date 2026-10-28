/**
 * Découpage et normalisation des adresses.
 * Le domaine enregistrable tient compte des suffixes privés (github.io, 000webhostapp.com…),
 * pour que « arnaque.github.io » soit traité comme un site à part entière.
 */
import { parse } from 'tldts';
import { toUnicode } from 'punycode';

export interface ParsedUrl {
  href: string;
  protocol: string;
  /** Hôte en ASCII (punycode), minuscule, sans « www. » ni point final. */
  host: string;
  /** Hôte en Unicode (pour l'affichage et la détection d'homographes). */
  hostUnicode: string;
  /** Domaine enregistrable en ASCII, ex. « impots.gouv.fr », « arnaque.github.io ». */
  domain: string;
  /** Partie du domaine sans le suffixe public, ex. « impots » pour « impots.gouv.fr ». */
  domainLabel: string;
  /** Suffixe public, ex. « gouv.fr », « co.uk », « github.io ». */
  suffix: string;
  /** Sous-domaine, ex. « impots.gouv.fr.secure » pour « impots.gouv.fr.secure.xyz ». */
  subdomain: string;
  isIp: boolean;
  isPrivateSuffix: boolean;
  path: string;
  /** Adresse complète contenait un « @ » avant l'hôte. */
  hasUserInfo: boolean;
  /** Réseau local (box internet, imprimante, localhost) : rien à analyser. */
  isLocal: boolean;
}

const LOCAL_HOST = /^(localhost|.*\.(local|lan|home|box|internal|localdomain)|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[::1\]|\[f[cd][0-9a-f]{2}:.*\])$/;

const stripWww = (h: string): string => (h.startsWith('www.') ? h.slice(4) : h);

export function parseUrl(input: string): ParsedUrl | null {
  let u: URL;
  try {
    u = new URL(input.includes('://') ? input : `https://${input}`);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = stripWww(u.hostname.toLowerCase().replace(/\.$/, ''));
  if (!host) return null;
  const p = parse(host, { allowPrivateDomains: true });
  const isIp = p.isIp === true || /^\[.*\]$/.test(host);
  const domain = isIp ? host : (p.domain ?? host);
  const suffix = p.publicSuffix ?? '';
  let hostUnicode = host;
  try {
    hostUnicode = toUnicode(host);
  } catch {
    /* hôte invalide en punycode : on garde l'ASCII */
  }
  return {
    href: u.href,
    protocol: u.protocol,
    host,
    hostUnicode,
    domain,
    domainLabel: isIp ? host : (p.domainWithoutSuffix ?? domain),
    suffix,
    subdomain: isIp ? '' : stripWww(p.subdomain ?? ''),
    isIp,
    isPrivateSuffix: p.isPrivate === true,
    path: (u.pathname + u.search).toLowerCase(),
    hasUserInfo: u.username !== '' || u.password !== '',
    isLocal: LOCAL_HOST.test(host),
  };
}

/** Domaine enregistrable d'un hôte (même règle que parseUrl). */
export function registrableDomain(host: string): string {
  const h = stripWww(host.toLowerCase().replace(/\.$/, ''));
  const p = parse(h, { allowPrivateDomains: true });
  return p.domain ?? h;
}

/** Découpe un libellé en mots : « impots-gouv-remboursement2 » → impots, gouv, remboursement. */
export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9À-ɏ]+|(?<=[a-z])(?=[0-9])|(?<=[0-9])(?=[a-z])/)
    .filter((t) => t.length > 0 && !/^[0-9]+$/.test(t));
}
