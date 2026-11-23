/**
 * Export statique des pages publiques (hébergement GitHub Pages).
 *
 * Rend chaque page publique via le routeur Express réel, puis écrit le HTML
 * dans `dist/` (une page = un dossier avec index.html) et copie `public/`.
 * Les formulaires sont remplacés par les coordonnées de l'association
 * (option `statique`) et les filtres du catalogue s'appliquent côté navigateur.
 * L'espace interne n'est pas exporté.
 *
 * Variables :
 *   BASE_PATH  préfixe des URL (ex. « /site-petits-oublies » pour un site de projet)
 *   SITE_URL   origine publique (ex. « https://vincentchaye.github.io »)
 *
 * Usage : BASE_PATH=/site-petits-oublies SITE_URL=https://… node scripts/build-static.js
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server/app.js';
import { chargerContenu } from '../src/server/content.js';
import { createPublicRouter } from '../src/server/routes/public.js';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sortie = path.join(racine, 'dist');
const base = (process.env.BASE_PATH || '').replace(/\/$/, '');
const site = (process.env.SITE_URL || 'http://localhost:8080').replace(/\/$/, '');

const contenu = chargerContenu();
const app = createApp({
  mount(a) {
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
const routes = new Set(pages);

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
  .replace(/(\s(?:href|src|action|content)=")(\/(?!\/)[^"]*)"/g, (_, a, u) => `${a}${reecrireUrl(u)}"`)
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
  await fs.writeFile(path.join(sortie, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${site}${base}/sitemap.xml\n`);
  await fs.writeFile(path.join(sortie, '.nojekyll'), '');

  console.log(`Export statique : ${pages.length} pages écrites dans dist/ (préfixe « ${base || '/'} »).`);
} finally {
  serveur.close();
}
