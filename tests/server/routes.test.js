/**
 * Tests d'intégration des routes : parcours public (pages, filtres, fiches,
 * formulaires) et espace interne (connexion, CSRF, file, export CSV).
 * Le serveur est monté sur un port éphémère, les données dans un dossier temporaire.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../../src/server/app.js';
import { chargerContenu } from '../../src/server/content.js';
import { createStore } from '../../src/server/store.js';
import { createSoumissions } from '../../src/server/soumissions.js';
import { createCompteurVues } from '../../src/server/vues.js';
import { createSocialRuntime } from '../../src/server/social.js';
import { createPublicRouter } from '../../src/server/routes/public.js';
import { createInterneRouter } from '../../src/server/routes/interne.js';
import { issueFormToken } from '../../src/security/antispam.js';

const SECRET = 'secret-de-test-0123456789abcdef-0123456789abcdef';
const ENV = {
  SOCIAL_MODE: 'simulation',
  SOCIAL_FACEBOOK_ENABLED: 'true',
  SOCIAL_FACEBOOK_API_KEY: 'cle-de-test',
  SOCIAL_SITE_URL: 'http://127.0.0.1',
};

let dossier;
let serveur;
let origine;
let contexte;

/** Jeton de formulaire déjà « assez vieux » pour passer le délai minimal anti-robot. */
const jetonPret = () => issueFormToken(SECRET, Date.now() - 10_000);

function corps(champs) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(champs)) p.set(k, v);
  return p;
}

/** POST formulaire, sans suivre les redirections. */
function poster(chemin, champs, { origin = origine, cookie } = {}) {
  const entetes = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (origin) entetes.Origin = origin;
  if (cookie) entetes.Cookie = cookie;
  return fetch(`${origine}${chemin}`, { method: 'POST', headers: entetes, body: corps(champs), redirect: 'manual' });
}

const obtenir = (chemin, cookie) => fetch(`${origine}${chemin}`, {
  headers: cookie ? { Cookie: cookie } : {},
  redirect: 'manual',
});

before(async () => {
  dossier = mkdtempSync(join(tmpdir(), 'routes-'));
  const contenu = chargerContenu();
  const store = createStore({ dir: dossier });
  const soumissions = createSoumissions({ store });
  const vues = createCompteurVues({ store, flushMs: 5 });
  await vues.charger();
  const social = createSocialRuntime({ env: ENV, dataDir: dossier, logger: { info() {}, warn() {}, error() {} }, getAnimaux: () => contenu.animaux, getVues: () => vues.tous(), getSeuil: () => 5 });
  contexte = { contenu, store, soumissions, vues, social };

  const app = createApp({
    logger: { error() {} },
    mount(a) {
      a.use('/interne', createInterneRouter({ contenu, soumissions, vues, social, secret: SECRET, seuil: 5 }));
      a.use(createPublicRouter({ contenu, soumissions, vues, baseUrl: 'http://127.0.0.1', secret: SECRET, logger: { error() {}, warn() {} } }));
    },
  });
  serveur = app.listen(0, '127.0.0.1');
  await new Promise((ok) => serveur.once('listening', ok));
  origine = `http://127.0.0.1:${serveur.address().port}`;
});

after(async () => {
  contexte?.social?.stop();
  await contexte?.vues?.stop();
  await new Promise((ok) => serveur.close(ok));
  rmSync(dossier, { recursive: true, force: true });
});

test('pages publiques : 200, titres attendus, aucun cookie', async () => {
  for (const [chemin, attendu] of [
    ['/', 'Refuge des Quatre Vents'],
    ['/animaux', 'Animaux à adopter'],
    ['/refuge', 'Le refuge'],
    ['/contact', 'Contact'],
    ['/mentions-legales', 'Mentions légales'],
    ['/confidentialite', 'confidentialité'],
  ]) {
    const r = await obtenir(chemin);
    assert.equal(r.status, 200, `${chemin} devrait répondre 200`);
    const html = await r.text();
    assert.ok(html.includes(attendu), `${chemin} devrait contenir « ${attendu} »`);
    assert.equal(r.headers.get('set-cookie'), null, `${chemin} ne doit émettre aucun cookie`);
    assert.match(r.headers.get('content-security-policy') ?? '', /default-src 'self'/);
  }
});

test('catalogue : filtres appliqués, animaux adoptés masqués', async () => {
  const tous = await (await obtenir('/animaux')).text();
  const adopte = contexte.contenu.animaux.find((a) => a.statut !== 'disponible');
  assert.ok(adopte, 'le jeu de données doit contenir un animal adopté');
  assert.ok(!tous.includes(`/animaux/${adopte.slug}"`), 'un animal adopté ne doit pas figurer au catalogue');

  const chats = await (await obtenir('/animaux?espece=chat')).text();
  for (const a of contexte.contenu.disponibles) {
    const present = chats.includes(`/animaux/${a.slug}"`);
    assert.equal(present, a.espece === 'chat', `${a.slug} (${a.espece}) mal filtré`);
  }

  const bidon = await obtenir('/animaux?espece=dragon');
  assert.equal(bidon.status, 200, 'un filtre inconnu est ignoré, pas une erreur');
});

test('fiche animal : rendu, compteur de consultations, 404', async () => {
  const a = contexte.contenu.disponibles[0];
  const avant = contexte.vues.tous()[a.slug] ?? 0;
  const r = await obtenir(`/animaux/${a.slug}`);
  assert.equal(r.status, 200);
  assert.ok((await r.text()).includes(a.nom));
  assert.equal(contexte.vues.tous()[a.slug], avant + 1);

  assert.equal((await obtenir('/animaux/inconnu-xyz')).status, 404);
  assert.equal((await obtenir('/page-absente')).status, 404);
});

test('sitemap : pages principales et fiches disponibles', async () => {
  const xml = await (await obtenir('/sitemap.xml')).text();
  assert.match(xml, /<urlset/);
  assert.ok(xml.includes(`/animaux/${contexte.contenu.disponibles[0].slug}<`));
  const adopte = contexte.contenu.animaux.find((a) => a.statut !== 'disponible');
  assert.ok(!xml.includes(`/animaux/${adopte.slug}<`), 'un animal adopté ne doit pas être dans le sitemap');
});

test('formulaire de contact : refus anti-spam', async () => {
  const valide = {
    _form_token: jetonPret(), nom: 'Léa Martin', email: 'lea@example.org',
    sujet: 'Visite', message: 'Bonjour, je souhaite visiter le refuge.', consentement: 'oui',
  };
  assert.equal((await poster('/contact', { ...valide, _form_token: '' })).status, 400, 'jeton absent');
  assert.equal((await poster('/contact', { ...valide, _form_token: issueFormToken(SECRET) })).status, 400, 'jeton trop récent');
  assert.equal((await poster('/contact', valide, { origin: 'http://attaquant.invalid' })).status, 403, 'origine étrangère');
  assert.equal((await poster('/contact', { ...valide, site_web: 'robot' })).status, 400, 'honeypot rempli');
  assert.equal((await contexte.soumissions.compter()).contact, 0, 'aucune soumission ne doit avoir été enregistrée');
});

test('formulaire de contact : erreurs de validation en français, puis succès', async () => {
  const r = await poster('/contact', { _form_token: jetonPret(), nom: 'L', email: 'pas-un-mail', message: 'court' });
  assert.equal(r.status, 400);
  const html = await r.text();
  assert.match(html, /Indiquez une adresse e-mail valide/);
  assert.match(html, /Cochez la case/);

  const ok = await poster('/contact', {
    _form_token: jetonPret(), nom: 'Léa Martin', email: 'lea@example.org',
    sujet: 'Visite', message: 'Bonjour, je souhaite visiter le refuge.', consentement: 'oui',
  });
  assert.equal(ok.status, 303);
  assert.match(ok.headers.get('location'), /^\/contact\?envoye=1/);
  const liste = await contexte.soumissions.lister('contact');
  assert.equal(liste.length, 1);
  assert.equal(liste[0].valeurs.email, 'lea@example.org');
  assert.ok(!('ip' in liste[0]) && !JSON.stringify(liste[0]).includes('127.0.0.1'), 'aucune IP ne doit être enregistrée');

  assert.match(await (await obtenir('/contact?envoye=1')).text(), /votre message a bien été enregistré/);
});

test("formulaire d'intérêt : lié à l'animal, refusé si déjà adopté", async () => {
  const a = contexte.contenu.disponibles[0];
  const ok = await poster(`/animaux/${a.slug}/interet`, {
    _form_token: jetonPret(), prenom: 'Jules', email: 'jules@example.org',
    logement: 'Maison avec jardin clos', message: 'Cet animal me plaît beaucoup, je suis disponible.',
    consentement: 'oui',
  });
  assert.equal(ok.status, 303);
  const liste = await contexte.soumissions.lister('interet');
  assert.equal(liste.length, 1);
  assert.equal(liste[0].valeurs.animal, a.nom);

  const adopte = contexte.contenu.animaux.find((x) => x.statut !== 'disponible');
  const r = await obtenir(`/animaux/${adopte.slug}/interet`);
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), `/animaux/${adopte.slug}`);
});

test('bénévolat et parrainage : succès et animal inconnu refusé', async () => {
  const ben = await poster('/refuge/benevolat', {
    _form_token: jetonPret(), nom: 'Sam Durand', email: 'sam@example.org',
    disponibilites: 'Samedi matin', envies: 'Promenades', consentement: 'oui',
  });
  assert.equal(ben.status, 303);
  assert.match(ben.headers.get('location'), /envoye=benevolat/);

  const don = await poster('/refuge/don', {
    _form_token: jetonPret(), nom: 'Sam Durand', email: 'sam@example.org',
    type: 'parrainage', animal: contexte.contenu.disponibles[0].slug,
    message: 'Je souhaite parrainer.', consentement: 'oui',
  });
  assert.equal(don.status, 303);

  const refus = await poster('/refuge/don', {
    _form_token: jetonPret(), nom: 'Sam Durand', email: 'sam@example.org',
    type: 'parrainage', animal: 'animal-inexistant', message: 'Je souhaite parrainer.', consentement: 'oui',
  });
  assert.equal(refus.status, 400);
  assert.match(await refus.text(), /pas disponible/);
  assert.equal((await contexte.soumissions.compter()).don_parrainage, 1);
});

test('espace interne : accès refusé sans session, secret erroné refusé', async () => {
  const r = await obtenir('/interne');
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/interne/connexion');
  assert.equal(r.headers.get('set-cookie'), null);

  const page = await obtenir('/interne/connexion');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /noindex/);

  const faux = await poster('/interne/connexion', { secret: 'mauvais-secret' });
  assert.equal(faux.status, 401);
  assert.equal(faux.headers.get('set-cookie'), null);
  assert.match(await faux.text(), /Secret incorrect/);

  const horsOrigine = await poster('/interne/connexion', { secret: SECRET }, { origin: 'http://attaquant.invalid' });
  assert.equal(horsOrigine.status, 403);
});

/** Ouvre une session interne et renvoie `{cookie, csrf}`. */
async function connexion() {
  const r = await poster('/interne/connexion', { secret: SECRET });
  assert.equal(r.status, 303);
  const brut = r.headers.get('set-cookie');
  assert.match(brut, /^sid=/);
  assert.match(brut, /HttpOnly/);
  assert.match(brut, /SameSite=Strict/);
  assert.match(brut, /Path=\/interne/);
  const cookie = brut.split(';')[0];
  const html = await (await obtenir('/interne', cookie)).text();
  const csrf = /name="_csrf" value="([^"]+)"/.exec(html)?.[1];
  assert.ok(csrf, 'un jeton CSRF doit être présent dans les pages internes');
  return { cookie, csrf };
}

test('espace interne : tableau de bord, journal, calendrier accessibles', async () => {
  const { cookie } = await connexion();
  for (const [chemin, attendu] of [
    ['/interne', 'Tableau de bord'],
    ['/interne/file', 'File de validation'],
    ['/interne/calendrier', 'Calendrier des envois'],
    ['/interne/journal', 'Journal d’envoi'],
    ['/interne/soumissions', 'Soumissions des formulaires'],
  ]) {
    const r = await obtenir(chemin, cookie);
    assert.equal(r.status, 200, `${chemin} devrait répondre 200`);
    assert.ok((await r.text()).includes(attendu), `${chemin} devrait contenir « ${attendu} »`);
  }
  const tb = await (await obtenir('/interne', cookie)).text();
  assert.ok(tb.includes(contexte.contenu.disponibles[0].nom), 'le classement doit lister les fiches');
});

test('espace interne : CSRF exigé, cycle de validation d’un post simulé', async () => {
  const { cookie, csrf } = await connexion();
  const scan = contexte.social.scan();
  assert.ok(scan.created.length > 0, 'le scan doit proposer au moins un post');
  const id = scan.created[0].id;

  const sansJeton = await poster(`/interne/file/${id}/modifier`, { text: 'Tentative sans jeton.' }, { cookie });
  assert.equal(sansJeton.status, 403, 'une action sans jeton CSRF doit être refusée');

  const modif = await poster(`/interne/file/${id}/modifier`, { _csrf: csrf, text: 'Texte relu par l’équipe.' }, { cookie });
  assert.equal(modif.status, 303);
  assert.equal(contexte.social.service.get(id).text, 'Texte relu par l’équipe.');

  const appro = await poster(`/interne/file/${id}/approuver`, { _csrf: csrf, scheduledAt: '' }, { cookie });
  assert.equal(appro.status, 303);
  assert.equal(contexte.social.service.get(id).status, 'planifie');

  const { processed } = await contexte.social.service.runDue();
  assert.equal(processed.length, 1);
  assert.equal(processed[0].ok, true, 'envoi simulé réussi');
  assert.equal(contexte.social.service.get(id).status, 'envoye');

  const journal = await (await obtenir('/interne/journal', cookie)).text();
  assert.match(journal, /simulation/);
  assert.ok(!journal.includes('cle-de-test'), 'aucune clé d’API ne doit apparaître dans le journal');

  const autre = contexte.social.service.list({ status: 'en_validation' })[0];
  const rejet = await poster(`/interne/file/${autre.id}/rejeter`, { _csrf: csrf, reason: 'Hors sujet' }, { cookie });
  assert.equal(rejet.status, 303);
  assert.equal(contexte.social.service.get(autre.id).status, 'rejete');

  const inconnu = await poster('/interne/file/post-inexistant/rejeter', { _csrf: csrf }, { cookie });
  assert.equal(inconnu.status, 303);
  assert.match(inconnu.headers.get('location'), /ko=echec/);
});

test('espace interne : export CSV protégé contre l’injection de formules', async () => {
  const { cookie } = await connexion();
  await poster('/contact', {
    _form_token: jetonPret(), nom: '=1+1', email: 'piege@example.org',
    sujet: 'Test', message: 'Un message de test suffisamment long.', consentement: 'oui',
  });
  const r = await obtenir('/interne/soumissions/export.csv?type=contact', cookie);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') ?? '', /text\/csv/);
  assert.match(r.headers.get('content-disposition') ?? '', /attachment; filename="soumissions-contact\.csv"/);
  const csv = await r.text();
  assert.ok(csv.includes("'=1+1"), 'une valeur commençant par = doit être préfixée');
  assert.ok(csv.includes('lea@example.org'));
});

test('espace interne : déconnexion et persistance sur disque', async () => {
  const { cookie, csrf } = await connexion();
  const sortie = await poster('/interne/deconnexion', { _csrf: csrf }, { cookie });
  assert.equal(sortie.status, 303);
  assert.match(sortie.headers.get('set-cookie'), /sid=; .*Max-Age=0/);
  assert.equal((await obtenir('/interne', cookie)).headers.get('location'), '/interne/connexion');

  await contexte.vues.flush();
  const fichierVues = join(dossier, 'vues.json');
  assert.ok(existsSync(fichierVues), 'les consultations doivent être persistées');
  assert.ok(Object.values(JSON.parse(readFileSync(fichierVues, 'utf8'))).some((n) => n > 0));
  assert.ok(existsSync(join(dossier, 'soumissions.json')), 'les soumissions doivent être persistées');
});
