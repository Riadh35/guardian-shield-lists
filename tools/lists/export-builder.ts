/**
 * Copie le constructeur de listes vers le dépôt public guardian-shield-lists.
 * Usage (Windows ou Linux) : npm run lists:export -- ..\guardian-shield-lists
 */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const target = process.argv[2];
if (!target) {
  console.error('Indiquez le dossier du dépôt guardian-shield-lists.');
  process.exit(1);
}
for (const dir of ['src/engine', 'tools/lists']) cpSync(dir, join(target, dir), { recursive: true });
mkdirSync(join(target, '.github/workflows'), { recursive: true });
cpSync('tools/lists/template/build-lists.yml', join(target, '.github/workflows/build-lists.yml'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies: Record<string, string> };
const tldts = pkg.dependencies['tldts'];
const punycode = pkg.dependencies['punycode'];
writeFileSync(
  join(target, 'package.json'),
  `${JSON.stringify({ name: 'guardian-shield-lists', private: true, type: 'module', dependencies: { tldts, punycode } }, null, 2)}\n`,
);
writeFileSync(
  join(target, 'README.md'),
  '# Guardian Wall — listes de menaces\n\nListes signées utilisées par l\'extension Guardian Wall – Anti-arnaque & Anti-phishing.\nConstruites toutes les heures à partir de Phishing.Database (MIT) et du Chrome UX Report (CC BY 4.0).\nLes fichiers publiés (branche `lists`) ne contiennent que des empreintes, pas d\'adresses en clair.\n',
);
console.log(`Constructeur copié dans ${target}. Lancez « npm install » puis commitez package-lock.json.`);
