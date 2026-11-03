/**
 * Tests des routes /interne/animaux : CSRF, validations (422), versions (409),
 * clés interdites, bascule de statut et scénario créer puis modifier visible sur /animaux.
 * Tout le contenu est copié dans un dossier temporaire : le content/ réel n'est jamais écrit.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, cpSync } from 'node:fs';
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

const SECRET = 'secret-de-test-0123456789abcdef-0123456789abcdef';
const ENV = { SOCIAL_MODE: 'simulation', SOCIAL_FACEBOOK_ENABLED: 'true', SOCIAL_FACEBOOK_API_KEY: 'cle-de-test', SOCIAL_SITE_URL: 'http://127.0.0.1' };
const REEL = new URL('../../content/', import.meta.url);

let dossier;
let dossierContenu;
let serveur;
let origine;
let contexte;
let contenu;
let avantReel;

const lireReel = () => readFileSync(new URL('animaux.json', REEL), 'utf8');

const poster = (chemin, champs, { cookie, origin = origine } = {}) => fetch(`${origine}${chemin}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(origin ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}) },
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

const fiche = (slug, extra = {}) => ({
  slug, nom: 'Gribouille', espece: 'chat', race: 'européen', age: '2', tranche: 'jeune', taille: 'petit', sexe: 'femelle',
  dateArrivee: '2026-10-01', statut: 'disponible', caractere: 'Douce et joueuse.', besoins: 'Un foyer calme.', histoire: 'Trouvée dans un jardin.',
  photo_src: '', photo_alt: '', ...extra,
});

before(async () => {
  avantReel = lireReel();
  dossier = mkdtempSync(join(tmpdir(), 'animaux-donnees-'));
  dossierContenu = mkdtempSync(join(tmpdir(), 'animaux-contenu-'));
  cpSync(new URL('.', REEL), dossierContenu, { recursive: true });
  contenu = chargerContenu({ dir: dossierContenu });
  const store = createStore({ dir: dossier });
  const soumissions = createSoumissions({ store });
  const vues = createCompteurVues({ store, flushMs: 5 });
  await vues.charger();
  const social = createSocialRuntime({ env: ENV, dataDir: dossier, logger: { info() {}, warn() {}, error() {} }, getAnimaux: () => contenu.animaux, getVues: () => vues.tous(), getSeuil: () => 5 });
  contexte = { vues, social };
  const app = createApp({
    logger: { error() {} },
    mount(a) {
      a.use('/interne', createInterneRouter({ contenu, soumissions, vues, social, secret: SECRET, seuil: 5, logger: { error() {} } }));
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
  rmSync(dossierContenu, { recursive: true, force: true });
});

test('isolation : content/ réel jamais modifié, lu depuis le dossier temporaire', () => {
  assert.equal(contenu.dossier, dossierContenu);
  assert.equal(lireReel(), avantReel);
});

test('CONTENT_DIR est pris en compte quand dir n’est pas fourni', () => {
  process.env.CONTENT_DIR = dossierContenu;
  try {
    assert.equal(chargerContenu().dossier, dossierContenu);
  } finally {
    delete process.env.CONTENT_DIR;
  }
});

test('sans session : redirection vers la connexion, pour les GET comme pour les POST', async () => {
  for (const chemin of ['/interne/animaux', '/interne/animaux/nouveau', '/interne/animaux/biscotte/modifier']) {
    const r = await obtenir(chemin);
    assert.equal(r.status, 303);
    assert.match(r.headers.get('location'), /\/interne\/connexion$/);
  }
  const p = await poster('/interne/animaux/nouveau', fiche('sans-session'));
  assert.equal(p.status, 303);
  assert.equal(contenu.animal('sans-session'), undefined);
});

test('liste et formulaires : 200, jeton CSRF, pas de style ni script en ligne, aucun lien public', async () => {
  const { cookie } = await connexion();
  for (const chemin of ['/interne/animaux', '/interne/animaux/nouveau', '/interne/animaux/biscotte/modifier']) {
    const r = await obtenir(chemin, cookie);
    assert.equal(r.status, 200, chemin);
    const html = await r.text();
    assert.match(html, /name="_csrf"/);
    assert.doesNotMatch(html, /\sstyle=|<style|onclick=|<script(?![^>]*\ssrc=)/i);
  }
  const liste = await (await obtenir('/interne/animaux', cookie)).text();
  assert.match(liste, /Biscotte/);
  const publique = await (await obtenir('/')).text();
  assert.doesNotMatch(publique, /\/interne/);
});

test('CSRF : POST sans jeton ou avec jeton faux -> 403, rien d’écrit', async () => {
  const { cookie } = await connexion();
  const avant = contenu.animaux.length;
  for (const champs of [fiche('csrf-test'), { ...fiche('csrf-test'), _csrf: 'faux' }]) {
    assert.equal((await poster('/interne/animaux/nouveau', champs, { cookie })).status, 403);
  }
  assert.equal((await poster('/interne/animaux/biscotte/modifier', { ...fiche('biscotte'), _version: '0' }, { cookie })).status, 403);
  assert.equal((await poster('/interne/animaux/biscotte/statut', { _version: '0', statut: 'adopte' }, { cookie })).status, 403);
  assert.equal(contenu.animaux.length, avant);
});

test('scénario : créer puis modifier une fiche, visible sur /animaux, écrite atomiquement', async () => {
  const { cookie, csrf } = await connexion();
  const cree = await poster('/interne/animaux/nouveau', { _csrf: csrf, ...fiche('gribouille', { photo_src: '/img/animaux/luna-1.svg', photo_alt: 'Une chatte' }) }, { cookie });
  assert.equal(cree.status, 303);
  assert.match(cree.headers.get('location'), /ok=cree/);

  let page = await (await obtenir('/adopter')).text();
  assert.match(page, /Gribouille/);
  assert.equal((await obtenir('/animaux/gribouille')).status, 200);

  const disque = JSON.parse(readFileSync(join(dossierContenu, 'animaux.json'), 'utf8'));
  assert.equal(disque.at(-1).slug, 'gribouille');
  assert.equal(disque.at(-1)._version, 1);
  assert.deepEqual(readdirSync(dossierContenu).filter((f) => f.endsWith('.tmp')), []);

  const form = await (await obtenir('/interne/animaux/gribouille/modifier', cookie)).text();
  assert.match(form, /name="_version" value="1"/);

  const modif = await poster('/interne/animaux/gribouille/modifier', { _csrf: csrf, ...fiche('gribouille', { nom: 'Gribouillette' }), _version: '1' }, { cookie });
  assert.equal(modif.status, 303);
  page = await (await obtenir('/adopter')).text();
  assert.match(page, /Gribouillette/);
  assert.doesNotMatch(page, />Gribouille</);
  assert.equal(contenu.animal('gribouille')._version, 2);
  assert.equal(lireReel(), avantReel);
});

test('409 : version périmée sur modification et changement de statut, rien d’écrit', async () => {
  const { cookie, csrf } = await connexion();
  const m = await poster('/interne/animaux/gribouille/modifier', { _csrf: csrf, ...fiche('gribouille', { nom: 'Périmée' }), _version: '1' }, { cookie });
  assert.equal(m.status, 409);
  assert.match(await m.text(), /modifiée par quelqu’un d’autre/);
  const b = await poster('/interne/animaux/gribouille/statut', { _csrf: csrf, _version: '1', statut: 'adopte' }, { cookie });
  assert.equal(b.status, 409);
  assert.equal(contenu.animal('gribouille').nom, 'Gribouillette');
  assert.equal(contenu.animal('gribouille').statut, 'disponible');
});

test('statut : les trois valeurs, « en soins » reste au catalogue, « adopté » en sort', async () => {
  const { cookie, csrf } = await connexion();
  const statut = (cible, version) => poster('/interne/animaux/gribouille/statut', { _csrf: csrf, _version: String(version), statut: cible }, { cookie });
  let v = contenu.animal('gribouille')._version;

  assert.equal((await statut('adopte', v)).status, 303);
  assert.equal(contenu.animal('gribouille').statut, 'adopte');
  assert.doesNotMatch(await (await obtenir('/adopter')).text(), /Gribouillette/);

  v = contenu.animal('gribouille')._version;
  assert.equal((await statut('en_soins', v)).status, 303);
  assert.equal(contenu.animal('gribouille').statut, 'en_soins');
  const catalogue = await (await obtenir('/adopter')).text();
  assert.match(catalogue, /Gribouillette/, 'un animal en soins reste visible au catalogue');
  assert.match(catalogue, /En soins/, 'son badge de statut est écrit en toutes lettres');

  v = contenu.animal('gribouille')._version;
  assert.equal((await statut('disponible', v)).status, 303);
  assert.equal(contenu.animal('gribouille').statut, 'disponible');

  v = contenu.animal('gribouille')._version;
  const inconnu = await statut('en_vacances', v);
  assert.equal(inconnu.status, 422, 'un statut hors liste blanche est refusé');
  assert.match(await inconnu.text(), /Statut inconnu/);
  assert.equal(contenu.animal('gribouille').statut, 'disponible');

  assert.equal((await poster('/interne/animaux/gribouille/statut', { _csrf: csrf, statut: 'adopte' }, { cookie })).status, 422, 'version absente');
  assert.equal((await poster('/interne/animaux/inconnu/statut', { _csrf: csrf, _version: '0', statut: 'adopte' }, { cookie })).status, 404);
});

test('fiche existante sans _version : éditable (version 0), puis versionnée', async () => {
  const { cookie, csrf } = await connexion();
  assert.equal(contenu.animal('biscotte')._version, undefined);
  const form = await (await obtenir('/interne/animaux/biscotte/modifier', cookie)).text();
  assert.match(form, /name="_version" value="0"/);
  const r = await poster('/interne/animaux/biscotte/modifier', {
    _csrf: csrf, ...fiche('biscotte', { nom: 'Biscotte', espece: 'chien', race: 'croisé labrador', age: '3', tranche: 'adulte', taille: 'grand' }), _version: '0',
  }, { cookie });
  assert.equal(r.status, 303);
  assert.equal(contenu.animal('biscotte')._version, 1);
});

test('422 : slug invalide, doublon, slug modifié, champs obligatoires, énumérations, photo', async () => {
  const { cookie, csrf } = await connexion();
  const avant = contenu.animaux.length;
  const creer = (extra) => poster('/interne/animaux/nouveau', { _csrf: csrf, ...fiche('valide-ok', extra) }, { cookie });

  for (const slug of ['A', 'Majuscule', 'avec espace', 'é-accent', 'x', 'a'.repeat(61), '']) {
    const r = await creer({ slug });
    assert.equal(r.status, 422, `slug « ${slug} »`);
    assert.match(await r.text(), /identifiant \(slug\)/i);
  }
  const doublon = await creer({ slug: 'biscotte' });
  assert.equal(doublon.status, 422);
  assert.match(await doublon.text(), /déjà utilisé/);

  const modifSlug = await poster('/interne/animaux/biscotte/modifier', { _csrf: csrf, ...fiche('autre-slug'), _version: '1' }, { cookie });
  assert.equal(modifSlug.status, 422);
  assert.match(await modifSlug.text(), /ne peut pas être modifié/);

  for (const champ of ['nom', 'espece', 'race', 'age', 'tranche', 'taille', 'sexe', 'dateArrivee', 'statut', 'caractere', 'besoins', 'histoire']) {
    const r = await creer({ [champ]: '' });
    assert.equal(r.status, 422, champ);
    assert.match(await r.text(), /obligatoire/);
  }
  for (const extra of [{ espece: 'dragon' }, { age: '-1' }, { age: 'abc' }, { dateArrivee: '2026-02-31' }, { statut: 'perdu' },
    { photo_src: '/etc/passwd', photo_alt: 'x' }, { photo_src: '/img/../secret.svg', photo_alt: 'x' }, { photo_src: 'http://evil/img/a.svg', photo_alt: 'x' },
    { photo_src: '/img/animaux/luna-1.svg', photo_alt: '' }]) {
    assert.equal((await creer(extra)).status, 422, JSON.stringify(extra));
  }
  assert.equal(contenu.animaux.length, avant);
  assert.equal(contenu.animal('valide-ok'), undefined);
});

test('422 : champs hors liste blanche et clés __proto__ / constructor rejetés', async () => {
  const { cookie, csrf } = await connexion();
  const avant = contenu.animaux.length;
  for (const cle of ['__proto__', 'constructor', 'prototype', 'isAdmin', 'photos', '_version2']) {
    const r = await poster('/interne/animaux/nouveau', { _csrf: csrf, ...fiche('cle-interdite'), [cle]: 'x' }, { cookie });
    assert.equal(r.status, 422, cle);
  }
  const r = await poster('/interne/animaux/biscotte/modifier', { _csrf: csrf, ...fiche('biscotte'), _version: '1', constructor: 'x' }, { cookie });
  assert.equal(r.status, 422);
  assert.equal(contenu.animaux.length, avant);
  assert.equal(({}).polluee, undefined);
  assert.equal(contenu.animal('cle-interdite'), undefined);
});

test('modification : version manquante -> 422 ; fiche inconnue -> 404', async () => {
  const { cookie, csrf } = await connexion();
  assert.equal((await poster('/interne/animaux/biscotte/modifier', { _csrf: csrf, ...fiche('biscotte') }, { cookie })).status, 422);
  assert.equal((await poster('/interne/animaux/inconnu/modifier', { _csrf: csrf, ...fiche('inconnu'), _version: '0' }, { cookie })).status, 404);
  assert.equal((await obtenir('/interne/animaux/inconnu/modifier', cookie)).status, 404);
});

test('créations concurrentes du même slug : une seule réussit', async () => {
  const { cookie, csrf } = await connexion();
  const envois = await Promise.all([1, 2, 3].map(() => poster('/interne/animaux/nouveau', { _csrf: csrf, ...fiche('course') }, { cookie })));
  assert.deepEqual(envois.map((r) => r.status).sort(), [303, 422, 422]);
  assert.equal(contenu.animaux.filter((a) => a.slug === 'course').length, 1);
  assert.equal(lireReel(), avantReel);
});
