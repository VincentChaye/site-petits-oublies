/**
 * Suivi des demandes (/interne/soumissions) : statut, note, filtre, CSV, animalSlug,
 * migration idempotente et non-régression (champ piège, purge, aucune IP).
 * Tout est écrit dans des dossiers temporaires : data/ et content/ réels ne sont jamais touchés.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { createApp } from '../../src/server/app.js';
import { chargerContenu } from '../../src/server/content.js';
import { createStore } from '../../src/server/store.js';
import { createSoumissions, NOTE_MAX } from '../../src/server/soumissions.js';
import { createCompteurVues } from '../../src/server/vues.js';
import { createSocialRuntime } from '../../src/server/social.js';
import { createPublicRouter } from '../../src/server/routes/public.js';
import { createInterneRouter } from '../../src/server/routes/interne.js';
import { issueFormToken } from '../../src/security/antispam.js';

const SECRET = 'secret-de-test-0123456789abcdef-0123456789abcdef';
const ENV = { SOCIAL_MODE: 'simulation', SOCIAL_FACEBOOK_ENABLED: 'true', SOCIAL_FACEBOOK_API_KEY: 'cle-de-test', SOCIAL_SITE_URL: 'http://127.0.0.1' };
const REEL = new URL('../../content/', import.meta.url);
const INDEX = resolve(import.meta.dirname, '../../src/server/index.js');
const silence = { info() {}, warn() {}, error() {} };

let dossier;
let dossierContenu;
let serveur;
let origine;
let contexte;
let contenu;
let session;

const jetonPret = () => issueFormToken(SECRET, Date.now() - 10_000);
const poster = (chemin, champs, { cookie } = {}) => fetch(`${origine}${chemin}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origine, ...(cookie ? { Cookie: cookie } : {}) },
  body: new URLSearchParams(Object.entries(champs)),
  redirect: 'manual',
});
const obtenir = (chemin, cookie) => fetch(`${origine}${chemin}`, { headers: cookie ? { Cookie: cookie } : {}, redirect: 'manual' });

async function connexion() {
  const r = await poster('/interne/connexion', { secret: SECRET });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const html = await (await obtenir('/interne', cookie)).text();
  return { cookie, csrf: /name="_csrf" value="([^"]+)"/.exec(html)[1] };
}

const interet = (animal) => ({
  _form_token: jetonPret(), prenom: 'Jules', email: 'jules@example.org',
  logement: 'Maison avec jardin clos', message: 'Cet animal me plaît beaucoup, je suis disponible.',
  consentement: 'oui', ...(animal ?? {}),
});

const maj = (id, champs, { avecCsrf = true, cookie = session.cookie } = {}) => poster(
  `/interne/soumissions/${id}`, { ...(avecCsrf ? { _csrf: session.csrf } : {}), ...champs }, { cookie },
);

before(async () => {
  dossier = mkdtempSync(join(tmpdir(), 'suivi-donnees-'));
  dossierContenu = mkdtempSync(join(tmpdir(), 'suivi-contenu-'));
  cpSync(new URL('.', REEL), dossierContenu, { recursive: true });
  contenu = chargerContenu({ dir: dossierContenu });
  const store = createStore({ dir: dossier });
  const soumissions = createSoumissions({ store });
  const vues = createCompteurVues({ store, flushMs: 5 });
  await vues.charger();
  const social = createSocialRuntime({ env: ENV, dataDir: dossier, logger: silence, getAnimaux: () => contenu.animaux, getVues: () => vues.tous(), getSeuil: () => 5 });
  contexte = { soumissions, vues, social, store };
  const app = createApp({
    logger: { error() {} },
    mount(a) {
      a.use('/interne', createInterneRouter({ contenu, soumissions, vues, social, secret: SECRET, seuil: 5, logger: { error() {} } }));
      a.use(createPublicRouter({ contenu, soumissions, vues, baseUrl: 'http://127.0.0.1', secret: SECRET, logger: silence }));
    },
  });
  serveur = app.listen(0, '127.0.0.1');
  await new Promise((ok) => serveur.once('listening', ok));
  origine = `http://127.0.0.1:${serveur.address().port}`;
  session = await connexion();
});

after(async () => {
  contexte?.social?.stop();
  await contexte?.vues?.stop();
  await new Promise((ok) => serveur.close(ok));
  rmSync(dossier, { recursive: true, force: true });
  rmSync(dossierContenu, { recursive: true, force: true });
});

test('animalSlug enregistré avec animal à la soumission du formulaire d’intérêt, statut initial « nouvelle »', async () => {
  const a = contenu.disponibles[0];
  const r = await poster(`/animaux/${a.slug}/interet`, interet());
  assert.equal(r.status, 303);
  const [s] = await contexte.soumissions.lister('interet');
  assert.equal(s.valeurs.animal, a.nom);
  assert.equal(s.valeurs.animalSlug, a.slug);
  assert.equal(s.statut, 'nouvelle');
  assert.equal(s.note, '');
  assert.ok(s.modifieLe);
  assert.ok(!JSON.stringify(s).includes('127.0.0.1'), 'aucune IP sur disque');
  // animalSlug n'est pas une colonne visible, « Animal concerné » est inchangé.
  const html = await (await obtenir('/interne/soumissions?type=interet', session.cookie)).text();
  assert.match(html, /Animal concerné/);
  assert.doesNotMatch(html, /animalSlug/);
});

test('autres types : statut initial « nouvelle »', async () => {
  const r = await poster('/contact', { _form_token: jetonPret(), nom: 'Léa Martin', email: 'lea@example.org', sujet: 'Horaires', message: 'Bonjour, quels sont vos horaires ?', consentement: 'oui' });
  assert.equal(r.status, 303);
  const [s] = await contexte.soumissions.lister('contact');
  assert.equal(s.statut, 'nouvelle');
});

test('sans session : redirection vers la connexion (GET et POST)', async () => {
  const g = await obtenir('/interne/soumissions');
  assert.equal(g.status, 303);
  assert.match(g.headers.get('location'), /\/interne\/connexion$/);
  const p = await poster('/interne/soumissions/x', { statut: 'traitee' });
  assert.equal(p.status, 303);
  assert.match(p.headers.get('location'), /\/interne\/connexion$/);
});

test('403 sans jeton CSRF, rien n’est modifié', async () => {
  const [s] = await contexte.soumissions.lister('interet');
  const r = await maj(s.id, { statut: 'traitee' }, { avecCsrf: false });
  assert.equal(r.status, 403);
  assert.equal((await contexte.soumissions.lister('interet'))[0].statut, 'nouvelle');
});

test('mise à jour valide : statut + note, redirection avec filtre conservé', async () => {
  const [s] = await contexte.soumissions.lister('interet');
  const r = await maj(s.id, { statut: 'en_cours', note: 'Appelé le matin.', filtre: 'nouvelle', champInconnu: 'x', id: 'autre', valeurs: 'pirate' });
  assert.equal(r.status, 303);
  const loc = r.headers.get('location');
  assert.match(loc, /type=interet/);
  assert.match(loc, /statut=nouvelle/);
  const apres = (await contexte.soumissions.lister('interet'))[0];
  assert.equal(apres.statut, 'en_cours');
  assert.equal(apres.note, 'Appelé le matin.');
  assert.equal(apres.id, s.id, 'liste blanche : id inchangé');
  assert.equal(apres.valeurs.prenom, 'Jules', 'liste blanche : valeurs inchangées');
  assert.ok(!('champInconnu' in apres));
});

test('statut invalide ou « archivee » : 422 en français, soumission inchangée', async () => {
  const [s] = await contexte.soumissions.lister('interet');
  for (const statut of ['archivee', 'inconnu', '', 'Traitee']) {
    const r = await maj(s.id, { statut });
    assert.equal(r.status, 422, statut);
    assert.match(await r.text(), /Statut inconnu/);
  }
  assert.equal((await contexte.soumissions.lister('interet'))[0].statut, 'en_cours');
});

test('note : 2000 caractères acceptés, 2001 refusés (points de code)', async () => {
  const [s] = await contexte.soumissions.lister('interet');
  const ok = await maj(s.id, { note: 'é'.repeat(NOTE_MAX) });
  assert.equal(ok.status, 303);
  assert.equal([...(await contexte.soumissions.lister('interet'))[0].note].length, 2000);
  const trop = await maj(s.id, { note: 'é'.repeat(NOTE_MAX + 1) });
  assert.equal(trop.status, 422);
  assert.match(await trop.text(), /trop longue/);
  // Un emoji = 1 point de code : 2000 emojis passent.
  // Corps limité à 20 ko : emojis (1 point de code) mêlés à de l'ASCII.
  assert.equal((await maj(s.id, { note: `${'😀'.repeat(500)}${'a'.repeat(1500)}` })).status, 303);
  assert.equal((await maj(s.id, { note: `${'😀'.repeat(500)}${'a'.repeat(1501)}` })).status, 422);
  assert.equal((await maj(s.id, { note: 'Appelé le matin.' })).status, 303);
});

test('rien à enregistrer : 422 ; soumission introuvable : 404', async () => {
  const [s] = await contexte.soumissions.lister('interet');
  assert.equal((await maj(s.id, {})).status, 422);
  const r = await maj('00000000-aucune', { statut: 'traitee' });
  assert.equal(r.status, 404);
  assert.match(await r.text(), /introuvable/);
});

test('filtre ?statut= : liste filtrée ; valeur inconnue : message en français, pas de plantage', async () => {
  const c = await contexte.soumissions.lister('contact');
  assert.equal(c[0].statut, 'nouvelle');
  const enCours = await (await obtenir('/interne/soumissions?type=interet&statut=en_cours', session.cookie)).text();
  assert.match(enCours, /Jules/);
  const traitees = await (await obtenir('/interne/soumissions?type=interet&statut=traitee', session.cookie)).text();
  assert.doesNotMatch(traitees, /Jules/);
  for (const v of ['archivee', 'x%00', '__proto__', '%3Cscript%3E']) {
    const r = await obtenir(`/interne/soumissions?type=interet&statut=${v}`, session.cookie);
    assert.equal(r.status, 422, v);
    assert.match(await r.text(), /statut inconnu/);
  }
  const tableau = await obtenir('/interne/soumissions?type=interet&statut[]=a&statut[]=b', session.cookie);
  assert.equal(tableau.status, 422);
});

test('vue : champ csrf présent, aucun script ni style en ligne', async () => {
  const html = await (await obtenir('/interne/soumissions?type=interet', session.cookie)).text();
  assert.match(html, /name="_csrf" value="[^"]+"/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/);
  assert.doesNotMatch(html, /\sstyle=|\son[a-z]+=/);
});

test('CSV : colonnes Statut, Note, Modifiée le, échappées (injection de formule)', async () => {
  const [s] = await contexte.soumissions.lister('interet');
  await maj(s.id, { statut: 'traitee', note: '=1+1, "ok"' });
  const r = await obtenir('/interne/soumissions/export.csv?type=interet', session.cookie);
  assert.equal(r.status, 200);
  const csv = await r.text();
  const [entete, ligne] = csv.replace(/^﻿/, '').split('\r\n');
  assert.match(entete, /,Statut,Note,Modifiée le$/);
  assert.match(ligne, /Traitée/);
  assert.ok(ligne.includes(`"'=1+1, ""ok"""`), ligne);
  assert.doesNotMatch(entete, /animalSlug/);
});

test('mises à jour concurrentes : aucune perte (store.update atomique)', async () => {
  const [s] = await contexte.soumissions.lister('contact');
  await Promise.all([
    contexte.soumissions.modifier(s.id, { statut: 'en_cours' }),
    contexte.soumissions.modifier(s.id, { note: 'Rappeler' }),
  ]);
  const [apres] = await contexte.soumissions.lister('contact');
  assert.equal(apres.statut, 'en_cours');
  assert.equal(apres.note, 'Rappeler');
});

test('non-régression : champ piège rempli → 400 et rien enregistré', async () => {
  const avant = (await contexte.soumissions.compter()).interet;
  const r = await poster(`/animaux/${contenu.disponibles[0].slug}/interet`, interet({ site_web: 'robot' }));
  assert.equal(r.status, 400);
  assert.equal((await contexte.soumissions.compter()).interet, avant);
});

test('non-régression : la purge à 12 mois supprime les anciennes et conserve les champs de suivi', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'suivi-purge-'));
  try {
    let t = Date.parse('2026-01-15T10:00:00Z');
    const s = createSoumissions({ store: createStore({ dir }), now: () => t });
    await s.ajouter('contact', { nom: 'Ancien' });
    t = Date.parse('2027-02-15T10:00:00Z');
    await s.ajouter('contact', { nom: 'Récent' });
    assert.equal(await s.purger(), 1);
    const [reste] = await s.lister('contact');
    assert.equal(reste.valeurs.nom, 'Récent');
    assert.equal(reste.statut, 'nouvelle');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('pas de lien public vers /interne', async () => {
  for (const chemin of ['/', '/animaux', '/contact']) {
    assert.doesNotMatch(await (await obtenir(chemin)).text(), /href="\/interne/);
  }
});

// ── Migration ────────────────────────────────────────────────────────────────
const ancien = (id, valeurs, extra = {}) => ({ id, createdAt: '2026-10-01T10:00:00.000Z', valeurs, ...extra });
const FICHES = [
  { slug: 'biscotte', nom: 'Biscotte' }, { slug: 'roxy-1', nom: 'Roxy' }, { slug: 'roxy-2', nom: 'Roxy' },
];

async function dépôtAncien() {
  const dir = mkdtempSync(join(tmpdir(), 'suivi-migration-'));
  const store = createStore({ dir });
  await store.update('soumissions', () => ({
    interet: [
      ancien('a', { animal: 'Biscotte' }),
      ancien('b', { animal: 'Roxy' }),
      ancien('c', { animal: 'Inconnu' }),
      ancien('d', { animal: 'Biscotte' }, { statut: 'traitee', note: 'déjà fait' }),
      ancien('e', { animal: 'Biscotte', animalSlug: 'autre' }),
    ],
    contact: [ancien('f', { nom: 'X' })],
    benevolat: [],
    don_parrainage: [],
  }), {});
  return { dir, store, soumissions: createSoumissions({ store }) };
}

test('migration : statut/note par défaut, déduction animalSlug, idempotente', async () => {
  const { dir, store, soumissions } = await dépôtAncien();
  try {
    const bilan = await soumissions.migrer({ animaux: FICHES });
    assert.deepEqual(bilan, { suivi: 5, animalSlug: 2 });
    const apres1 = JSON.stringify(await store.read('soumissions', {}));
    const par = Object.fromEntries((await soumissions.lister('interet')).map((s) => [s.id, s]));
    assert.equal(par.a.valeurs.animalSlug, 'biscotte');
    assert.equal(par.a.statut, 'nouvelle');
    assert.equal(par.a.note, '');
    assert.equal(par.b.valeurs.animalSlug, undefined, 'nom ambigu : pas de déduction');
    assert.equal(par.c.valeurs.animalSlug, undefined, 'nom inconnu : pas de déduction');
    assert.equal(par.b.statut, 'nouvelle', 'nom ambigu : migré sans erreur');
    assert.equal(par.d.statut, 'traitee', 'statut existant conservé');
    assert.equal(par.d.note, 'déjà fait');
    assert.equal(par.d.valeurs.animalSlug, 'biscotte');
    assert.equal(par.e.valeurs.animalSlug, 'autre', 'animalSlug existant non écrasé');
    const second = await soumissions.migrer({ animaux: FICHES });
    assert.deepEqual(second, { suivi: 0, animalSlug: 0 });
    assert.equal(JSON.stringify(await store.read('soumissions', {})), apres1, 'résultat identique');
    // Sans store existant : pas d'erreur non plus.
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── Démarrage ────────────────────────────────────────────────────────────────
function portLibre() {
  return new Promise((ok, ko) => {
    const s = createServer();
    s.once('error', ko);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); });
  });
}

test('index.js : la migration est exécutée avant l’écoute (fichier migré dès « Serveur démarré »)', async () => {
  const source = readFileSync(INDEX, 'utf8');
  const iPurge = source.indexOf('soumissions.purger()');
  const iMigr = source.indexOf('soumissions.migrer(');
  const iSocial = source.indexOf('social.start()');
  const iListen = source.indexOf('app.listen(');
  assert.ok(iPurge > 0 && iMigr > iPurge && iSocial > iMigr && iListen > iMigr, 'ordre : purge < migration < social.start / listen');
  assert.match(source.slice(iMigr - 40, iMigr), /await/);
  assert.match(source.slice(iMigr, iSocial), /process\.exit\(1\)/);

  const dir = mkdtempSync(join(tmpdir(), 'suivi-demarrage-'));
  try {
    writeFileSync(join(dir, 'soumissions.json'), JSON.stringify({
      interet: [ancien('a', { animal: 'Biscotte' }, { createdAt: new Date().toISOString() })], contact: [], benevolat: [], don_parrainage: [],
    }));
    const port = await portLibre();
    const env = { ...process.env, PORT: String(port), DATA_DIR: dir, INTERNAL_SECRET: SECRET };
    const enfant = spawn(process.execPath, [INDEX], { cwd: resolve(import.meta.dirname, '../..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
    let sortie = '';
    let instantané = null;
    const minuterie = setTimeout(() => enfant.kill('SIGKILL'), 15000);
    enfant.stdout.on('data', (d) => {
      sortie += d;
      if (instantané === null && /Serveur démarré/.test(sortie)) {
        instantané = readFileSync(join(dir, 'soumissions.json'), 'utf8');
        enfant.kill('SIGTERM');
      }
    });
    enfant.stderr.on('data', (d) => { sortie += d; });
    await new Promise((ok) => enfant.on('close', ok));
    clearTimeout(minuterie);
    assert.ok(instantané, `serveur non démarré : ${sortie}`);
    const [s] = JSON.parse(instantané).interet;
    assert.equal(s.statut, 'nouvelle');
    assert.equal(s.note, '');
    assert.equal(s.valeurs.animalSlug, 'biscotte');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
