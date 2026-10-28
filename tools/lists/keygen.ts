/**
 * Génère la paire de clés Ed25519 qui signe les listes.
 *  - La clé PRIVÉE va dans le secret GitHub GW_LIST_SIGNING_KEY du dépôt guardian-shield-lists,
 *    et nulle part ailleurs (jamais dans le code, jamais dans un fichier versionné).
 *  - La clé PUBLIQUE est écrite dans src/engine/data/list-public-key.json et embarquée dans l'extension.
 * Usage : node --experimental-strip-types tools/lists/keygen.ts
 */
import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
const spki = publicKey.export({ format: 'der', type: 'spki' });
const raw = spki.subarray(spki.length - 32).toString('base64');

writeFileSync('src/engine/data/list-public-key.json', `${JSON.stringify({ alg: 'Ed25519', raw }, null, 2)}\n`);
console.log('Clé publique écrite dans src/engine/data/list-public-key.json');
console.log('\nClé PRIVÉE (à coller dans le secret GitHub GW_LIST_SIGNING_KEY, puis à effacer de ce terminal) :\n');
console.log(pkcs8);
