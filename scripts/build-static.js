/**
 * Export statique des pages publiques (hébergement GitHub Pages).
 *
 * Rend chaque page publique via le routeur Express réel, puis écrit le HTML
 * dans `dist/` (une page = un dossier avec index.html) et copie `public/`.
 * Les formulaires sont remplacés par les coordonnées de l'association
 * (option `statique`) et les filtres du catalogue s'appliquent côté navigateur.
 * De l'espace interne, seuls sont exportés (démonstration) :
 *   - la page de connexion, dont l'envoi mène directement à l'atelier ;
 *   - l'atelier Instagram / Facebook, rendu par le vrai routeur interne puis
 *     animé dans le navigateur (public/js/atelier-demo.js) avec les textes
 *     préremplis calculés ici. Aucun dépôt ni envoi n'est possible.
 *
 * Variables :
 *   BASE_PATH  préfixe des URL (ex. « /site-petits-oublies » pour un site de projet)
 *   SITE_URL   origine publique (ex. « https://vincentchaye.github.io »)
 *
 * Usage : BASE_PATH=/site-petits-oublies SITE_URL=https://… node scripts/build-static.js
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server/app.js';
import { chargerContenu } from '../src/server/content.js';
import { createPublicRouter } from '../src/server/routes/public.js';
import { createInterneRouter } from '../src/server/routes/interne.js';
import { createSocialRuntime } from '../src/server/social.js';
import { TRIGGERS } from '../src/integrations/index.js';
import {
  RESEAUX_ATELIER, LIBELLES_RESEAU, CADRAGES_INSTAGRAM, CADRAGE_FACEBOOK,
  INSTAGRAM_MAX, FACEBOOK_MAX, HASHTAGS_MAX, ALT_MAX, SEUIL_COUPE,
} from '../src/server/routes/interne-atelier.js';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sortie = path.join(racine, 'dist');
const base = (process.env.BASE_PATH || '').replace(/\/$/, '');
const site = (process.env.SITE_URL || 'http://localhost:8080').replace(/\/$/, '');

const contenu = chargerContenu();
// Secret jetable, propre à l'export : sert seulement à ouvrir une session locale.
const secretExport = `export-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const dossierTemp = await fs.mkdtemp(path.join(os.tmpdir(), 'export-statique-'));
const social = createSocialRuntime({
  env: { SOCIAL_SITE_URL: site + base },
  dataDir: dossierTemp,
  logger: { log() {}, info() {}, warn() {}, error: console.error },
  getAnimaux: () => contenu.animaux,
  getVues: () => ({}),
  getSeuil: () => 5,
});
const app = createApp({
  mount(a) {
    a.use('/interne', createInterneRouter({
      contenu, social, secret: secretExport,
      soumissions: {}, vues: {},
      logger: { warn() {}, error: console.error },
    }));
    a.use(createPublicRouter({
      contenu,
      soumissions: { ajouter: async () => {} },
      vues: { incrementer: () => {} },
      baseUrl: site + base,
      secret: 'export-statique',
      statique: true,
    }));
  },
});

// Pages exportées : celles du plan du site, plus les projets d'adoption ouverts.
const pages = ['/', '/adopter', '/nos-missions', '/famille-accueil', '/nous-soutenir', '/conseils',
  '/contact', '/mentions-legales', '/confidentialite',
  ...contenu.conseils.map((c) => `/conseils/${c.slug}`),
  ...contenu.visibles.map((a) => `/animaux/${a.slug}`),
  ...contenu.visibles.filter((a) => ['disponible', 'en_soins'].includes(a.statut))
    .map((a) => `/animaux/${a.slug}/interet`),
];
// Pages internes exportées à part, mais leurs liens prennent aussi le « / » final.
const routes = new Set([...pages, '/interne/connexion', '/interne/atelier']);
// Variable vue par tous les gabarits : formulaires remplacés, démo de l'atelier.
app.locals.statique = true;

/** Préfixe une URL absolue du site ; ajoute « / » final aux pages (pas de redirection). */
function reecrireUrl(url) {
  const m = /^(\/[^?#]*)?([?#].*)?$/.exec(url);
  if (!m) return url;
  const chemin = m[1] || '/';
  const reste = m[2] || '';
  const page = routes.has(chemin) && chemin !== '/' ? `${chemin}/` : chemin;
  return base + page + reste;
}

const reecrireHtml = (html) => html
  .replace(/(\s(?:href|src|action|formaction|content)=")(\/(?!\/)[^"]*)"/g, (_, a, u) => `${a}${reecrireUrl(u)}"`)
  .replace(/url\("(\/(?!\/)[^"]*)"\)/g, (_, u) => `url("${base}${u}")`);

const serveur = app.listen(0);
await new Promise((r) => serveur.once('listening', r));
const origine = `http://127.0.0.1:${serveur.address().port}`;

try {
  await fs.rm(sortie, { recursive: true, force: true });
  await fs.cp(path.join(racine, 'public'), sortie, { recursive: true });

  for (const p of pages) {
    const res = await fetch(origine + p, { redirect: 'manual' });
    if (res.status !== 200) throw new Error(`${p} : statut ${res.status}`);
    const fichier = path.join(sortie, p, 'index.html');
    await fs.mkdir(path.dirname(fichier), { recursive: true });
    await fs.writeFile(fichier, reecrireHtml(await res.text()));
  }

  // Page d'erreur servie par GitHub Pages pour toute adresse inconnue.
  const r404 = await fetch(`${origine}/page-inexistante`);
  await fs.writeFile(path.join(sortie, '404.html'), reecrireHtml(await r404.text()));

  // ── Espace interne (démo) ──
  const ecrirePage = async (route, html) => {
    await fs.mkdir(path.join(sortie, route), { recursive: true });
    await fs.writeFile(path.join(sortie, route, 'index.html'), reecrireHtml(html));
  };
  const rConnexion = await fetch(`${origine}/interne/connexion`);
  await ecrirePage('/interne/connexion', await rConnexion.text());

  // Session locale via le vrai formulaire de connexion.
  const login = await fetch(`${origine}/interne/connexion`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: origine },
    body: new URLSearchParams({ secret: secretExport }),
  });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  if (login.status !== 303 || !cookie) throw new Error(`connexion interne impossible (statut ${login.status})`);
  const interne = async (url) => {
    const r = await fetch(origine + url, { headers: { cookie }, redirect: 'manual' });
    if (r.status !== 200) throw new Error(`${url} : statut ${r.status}`);
    return r.text();
  };

  // Textes préremplis : chaque fiche × réseau × gabarit, tels que le serveur les produit.
  const decoder = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#34;|&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const prefill = {};
  for (const a of contenu.disponibles) {
    for (const reseau of RESEAUX_ATELIER) {
      for (const gabarit of TRIGGERS) {
        const html = await interne(`/interne/atelier?${new URLSearchParams({ animal: a.slug, reseau, gabarit })}`);
        const texte = /<textarea id="at-texte"[^>]*>([\s\S]*?)<\/textarea>/.exec(html)?.[1] ?? '';
        const hashtags = /id="at-hashtags" name="hashtags" value="([^"]*)"/.exec(html)?.[1] ?? '';
        if (texte) prefill[`${a.slug}|${reseau}|${gabarit}`] = { texte: decoder(texte), hashtags: decoder(hashtags) };
      }
    }
  }
  app.locals.atelierDemo = {
    animaux: Object.fromEntries(contenu.disponibles.map((a) => [a.slug, {
      nom: a.nom,
      image: a.photos?.[0]?.src ? base + a.photos[0].src : null,
      imageAlt: a.photos?.[0]?.alt || '',
      url: site + reecrireUrl(`/animaux/${a.slug}`),
    }])),
    prefill,
    reseaux: { ...LIBELLES_RESEAU },
    limites: { instagram: INSTAGRAM_MAX, facebook: FACEBOOK_MAX },
    hashtagsMax: { ...HASHTAGS_MAX },
    seuils: { ...SEUIL_COUPE },
    altMax: ALT_MAX,
    cadrages: { ...CADRAGES_INSTAGRAM },
    facebook: { ...CADRAGE_FACEBOOK },
  };
  await ecrirePage('/interne/atelier', await interne('/interne/atelier'));

  // Anciennes adresses : redirection côté client.
  const redirections = { '/refuge': '/nos-missions', '/animaux': '/adopter' };
  for (const [de, vers] of Object.entries(redirections)) {
    const cible = reecrireUrl(vers);
    const fichier = path.join(sortie, de, 'index.html');
    await fs.mkdir(path.dirname(fichier), { recursive: true });
    await fs.writeFile(fichier, `<!doctype html><meta charset="utf-8"><title>Redirection</title><meta http-equiv="refresh" content="0; url=${cible}"><link rel="canonical" href="${site}${cible}"><p><a href="${cible}">Continuer</a></p>\n`);
  }

  // CSS : chemins absolus préfixés.
  const css = path.join(sortie, 'css');
  for (const f of await fs.readdir(css)) {
    if (!f.endsWith('.css')) continue;
    const fp = path.join(css, f);
    await fs.writeFile(fp, (await fs.readFile(fp, 'utf8')).replace(/url\((["']?)\/(?!\/)/g, `url($1${base}/`));
  }

  const plan = pages.map((p) => `  <url><loc>${site}${reecrireUrl(p)}</loc></url>`).join('\n');
  await fs.writeFile(path.join(sortie, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${plan}\n</urlset>\n`);
  await fs.writeFile(path.join(sortie, 'robots.txt'), `User-agent: *\nDisallow: ${base}/interne\nSitemap: ${site}${base}/sitemap.xml\n`);
  await fs.writeFile(path.join(sortie, '.nojekyll'), '');

  console.log(`Export statique : ${pages.length} pages écrites dans dist/ (préfixe « ${base || '/'} »).`);
} finally {
  serveur.close();
  social.stop?.();
  await fs.rm(dossierTemp, { recursive: true, force: true });
}
