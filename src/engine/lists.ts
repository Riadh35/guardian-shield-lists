/**
 * Listes compactes : chaque entrée (domaine ou adresse) est réduite à une empreinte
 * de 64 bits, triée, cherchée par dichotomie. 8 octets par entrée, recherche en O(log n).
 *
 * Format binaire « GWL1 » (petit-boutiste) :
 *   0  magic "GWL1"     4 octets
 *   4  version          u32
 *   8  nombre d'entrées u32
 *   12 type             u8 (0 = domaines dangereux, 1 = adresses dangereuses, 2 = domaines populaires)
 *   13 réservé          3 octets
 *   16 date de création u32 (secondes Unix)
 *   20 entrées          n × (hi u32, lo u32), triées
 * La signature Ed25519 du fichier entier est distribuée à côté (fichier .sig, 64 octets).
 */

export const LIST_MAGIC = 'GWL1';
export const HEADER_SIZE = 20;

export const ListKind = {
  DangerousDomains: 0,
  DangerousUrls: 1,
  PopularDomains: 2,
} as const;
export type ListKind = (typeof ListKind)[keyof typeof ListKind];

/** Empreinte 64 bits rapide et déterministe (variante cyrb53, deux moitiés de 32 bits). */
export function hash64(str: string): [number, number] {
  let h1 = 0xdeadbeef ^ 0x9e3779b9;
  let h2 = 0x41c6ce57 ^ 0x85ebca6b;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return [h1 >>> 0, h2 >>> 0];
}

/** Normalise une adresse pour la liste d'adresses : hôte + chemin, sans paramètres ni « / » final. */
export function normalizeUrlKey(host: string, pathname: string): string {
  const path = pathname.split('?')[0]!.split('#')[0]!.replace(/\/+$/, '').toLowerCase();
  return `${host.toLowerCase().replace(/^www\./, '')}${path}`;
}

export class CompactSet {
  readonly kind: ListKind;
  readonly createdAt: number;
  private readonly data: Uint32Array;

  private constructor(kind: ListKind, createdAt: number, data: Uint32Array) {
    this.kind = kind;
    this.createdAt = createdAt;
    this.data = data;
  }


  get size(): number {
    return this.data.length / 2;
  }

  static empty(kind: ListKind): CompactSet {
    return new CompactSet(kind, 0, new Uint32Array(0));
  }

  /** Construit une liste à partir d'entrées en clair (outil de construction, tests). */
  static fromEntries(kind: ListKind, entries: Iterable<string>, createdAt = Math.floor(Date.now() / 1000)): CompactSet {
    const keys: Array<[number, number]> = [];
    for (const e of entries) keys.push(hash64(e));
    keys.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const data = new Uint32Array(keys.length * 2);
    let n = 0;
    for (let i = 0; i < keys.length; i++) {
      const [hi, lo] = keys[i]!;
      if (n > 0 && data[(n - 1) * 2] === hi && data[(n - 1) * 2 + 1] === lo) continue; // doublon
      data[n * 2] = hi;
      data[n * 2 + 1] = lo;
      n++;
    }
    return new CompactSet(kind, createdAt, data.slice(0, n * 2));
  }

  has(entry: string): boolean {
    const [hi, lo] = hash64(entry);
    let a = 0;
    let b = this.size - 1;
    while (a <= b) {
      const m = (a + b) >>> 1;
      const mh = this.data[m * 2]!;
      const ml = this.data[m * 2 + 1]!;
      if (mh === hi && ml === lo) return true;
      if (mh < hi || (mh === hi && ml < lo)) a = m + 1;
      else b = m - 1;
    }
    return false;
  }

  /** Domaine ou l'un de ses parents présent dans la liste (jusqu'au domaine enregistrable). */
  hasHostOrParent(host: string, registrable: string): string | null {
    let h = host;
    for (;;) {
      if (this.has(h)) return h;
      if (h === registrable) return null;
      const dot = h.indexOf('.');
      if (dot < 0) return null;
      h = h.slice(dot + 1);
      if (h.length < registrable.length) return null;
    }
  }

  serialize(): Uint8Array {
    const out = new Uint8Array(HEADER_SIZE + this.data.length * 4);
    const view = new DataView(out.buffer);
    for (let i = 0; i < 4; i++) out[i] = LIST_MAGIC.charCodeAt(i);
    view.setUint32(4, 1, true);
    view.setUint32(8, this.size, true);
    view.setUint8(12, this.kind);
    view.setUint32(16, this.createdAt, true);
    for (let i = 0; i < this.data.length; i++) view.setUint32(HEADER_SIZE + i * 4, this.data[i]!, true);
    return out;
  }

  static parse(bytes: Uint8Array): CompactSet {
    if (bytes.length < HEADER_SIZE) throw new Error('Liste trop courte');
    const magic = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
    if (magic !== LIST_MAGIC) throw new Error('Format de liste inconnu');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = view.getUint32(4, true);
    if (version !== 1) throw new Error(`Version de liste non prise en charge : ${version}`);
    const count = view.getUint32(8, true);
    const kind = view.getUint8(12) as ListKind;
    const createdAt = view.getUint32(16, true);
    if (bytes.length !== HEADER_SIZE + count * 8) throw new Error('Taille de liste incohérente');
    const data = new Uint32Array(count * 2);
    for (let i = 0; i < data.length; i++) data[i] = view.getUint32(HEADER_SIZE + i * 4, true);
    for (let i = 1; i < count; i++) {
      const ph = data[(i - 1) * 2]!;
      const pl = data[(i - 1) * 2 + 1]!;
      const h = data[i * 2]!;
      const l = data[i * 2 + 1]!;
      if (ph > h || (ph === h && pl >= l)) throw new Error('Liste non triée');
    }
    return new CompactSet(kind, createdAt, data);
  }
}

/**
 * Vérifie la signature Ed25519 d'une liste avant de l'utiliser.
 * Une liste mal signée est refusée : l'extension garde alors la dernière liste valide.
 */
export async function verifyListSignature(bytes: Uint8Array, signature: Uint8Array, publicKeyRaw: Uint8Array): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('raw', publicKeyRaw as BufferSource, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, signature as BufferSource, bytes as BufferSource);
  } catch {
    return false;
  }
}

/** Ensemble des listes utilisées par le moteur. */
export interface ListBundle {
  dangerousDomains: CompactSet;
  dangerousUrls: CompactSet;
  popularDomains: CompactSet;
  /** Signalements communautaires validés (Phase 5) ; vide en version gratuite. */
  community?: CompactSet;
}

export function emptyBundle(): ListBundle {
  return {
    dangerousDomains: CompactSet.empty(ListKind.DangerousDomains),
    dangerousUrls: CompactSet.empty(ListKind.DangerousUrls),
    popularDomains: CompactSet.empty(ListKind.PopularDomains),
  };
}
