/**
 * Plateformes où n'importe qui peut créer un site en sous-domaine (hébergement gratuit,
 * créateurs de sites, stockage public). Très utilisées pour le phishing : le domaine
 * principal est légitime, mais chaque sous-domaine appartient à un inconnu.
 */
export const USER_CONTENT_PLATFORMS: ReadonlySet<string> = new Set([
  '000webhostapp.com', 'weebly.com', 'weeblysite.com', 'webnode.com', 'webnode.page', 'jimdofree.com', 'jimdosite.com',
  'wixsite.com', 'wix.com', 'squarespace.com', 'godaddysites.com', 'tumblr.com', 'neocities.org', 'glitch.me',
  'github.io', 'gitlab.io', 'netlify.app', 'netlify.com', 'vercel.app', 'pages.dev', 'workers.dev', 'web.app',
  'firebaseapp.com', 'herokuapp.com', 'onrender.com', 'replit.app', 'repl.co', 'ngrok.io', 'ngrok-free.app',
  'blogspot.com', 'wordpress.com', 'sites.google.com', 'googleusercontent.com', 'storage.googleapis.com',
  'appspot.com', 'azurewebsites.net', 'web.core.windows.net', 'blob.core.windows.net', 'sharepoint.com',
  'powerappsportals.com', 'b-cdn.net', 'ipfs.io', 'cf-ipfs.com', 'infura-ipfs.io', 'fleek.co', 'dweb.link',
  'hostingersite.com', 'systeme.io', 'odoo.com', 'myshoptet.com', 'mykajabi.com', 'wpengine.com', 'freshdesk.com',
  'teachable.com', 'usrfiles.com', 'filesusr.com', 'atwebpages.com', 'mybluehost.me', 'webcindario.com',
  'appdomain.cloud', 'typeform.com', 'jotform.com', 'forms.office.com', 'canva.site', 'my.canva.site', 'carrd.co',
  'docs.google.com', 'notion.site', 'framer.website', 'framer.app', 'webflow.io', 'strikingly.com', 'mystrikingly.com', 'yolasite.com',
  'site123.me', 'tilda.ws', 'beget.tech', 'xsph.ru', 'tmweb.ru', 'tw1.ru', 'co.vu', 'r2.dev', 'surge.sh', 'w3spaces.com',
]);

/** Raccourcisseurs d'adresses : la vraie destination est cachée. */
export const URL_SHORTENERS: ReadonlySet<string> = new Set([
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'cutt.ly', 'rebrand.ly', 'shorturl.at', 'tiny.cc', 'rb.gy',
  'urlz.fr', 'v.gd', 's.id', 'buff.ly', 'lnkd.in', 'shorturl.fr', 'bit.do', 't.ly', 'qrco.de', 'linktr.ee', 'app.link',
]);

/** Domaine enregistrable (ou hôte) relevant d'une plateforme à contenu utilisateur. */
export function userContentPlatformOf(host: string, registrable: string): string | null {
  if (USER_CONTENT_PLATFORMS.has(registrable)) return registrable;
  for (const p of USER_CONTENT_PLATFORMS) if (host === p || host.endsWith(`.${p}`)) return p;
  // Blogspot existe sous de nombreuses extensions nationales (blogspot.fr, blogspot.sn…).
  if (/(^|\.)blogspot\.[a-z.]+$/.test(host)) return 'blogspot';
  return null;
}
