/**
 * Garde-fous avant publication des listes (ADR-0005) :
 *  - ne rien publier si rien n'a changé ;
 *  - refuser une liste de domaines dangereux tombée sous 50 % de la précédente (source cassée) ;
 *  - refuser une publication non signée.
 * Usage : node --experimental-strip-types tools/lists/guard.ts <ancien manifest> <nouveau manifest>
 * Écrit « publish=true|false » dans $GITHUB_OUTPUT.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

interface Manifest { signed: boolean; files: Record<string, { entries: number; sha256: string }> }

const [prevPath, nextPath] = process.argv.slice(2);
const next = JSON.parse(readFileSync(nextPath!, 'utf8')) as Manifest;
const prev = prevPath && existsSync(prevPath) ? (JSON.parse(readFileSync(prevPath, 'utf8')) as Manifest) : null;

function decide(): { publish: boolean; why: string } {
  if (!next.signed) return { publish: false, why: 'listes non signées (secret GW_LIST_SIGNING_KEY absent)' };
  if (!prev) return { publish: true, why: 'première publication' };
  const changed = Object.keys(next.files).some((k) => next.files[k]!.sha256 !== prev.files[k]?.sha256);
  if (!changed) return { publish: false, why: 'aucun changement' };
  for (const [k, f] of Object.entries(next.files)) {
    const old = prev.files[k]?.entries ?? 0;
    if (old > 1000 && f.entries < old * 0.5) return { publish: false, why: `${k} : ${f.entries} entrées contre ${old} (chute anormale)` };
  }
  return { publish: true, why: 'nouvelles données' };
}

const d = decide();
console.log(`Publication : ${d.publish ? 'oui' : 'non'} (${d.why})`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `publish=${d.publish}\n`);
if (!d.publish && d.why.includes('anormale')) process.exitCode = 1; // l'échec du workflow sert d'alerte par email
