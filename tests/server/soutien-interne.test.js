/**
 * Tests des routes /interne/soutien : CSRF, validation des besoins et des
 * collectes (422), versions (409), et répercussion immédiate sur la page
 * publique « Nous soutenir », y compris le masquage des collectes passées.
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

const lireReel = () => readFileSync(new URL('soutien.json', REEL), 'utf8');

/** Date ISO décalée de `jours` par rapport à aujourd'hui. */
const dateDans = (jours) => new Date(Date.now() + jours * 86400000).toISOString().slice(0, 10);

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

/** Version courante du contenu « soutien ». */
const version = () => String(contenu.soutien._version ?? 0);

before(async () => {
  avantReel = lireReel();
  dossier = mkdtempSync(join(tmpdir(), 'soutien-donnees-'));
  dossierContenu = mkdtempSync(join(tmpdir(), 'soutien-contenu-'));
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

test('isolation : content/soutien.json réel jamais modifié', () => {
  assert.equal(contenu.dossier, dossierContenu);
  assert.equal(lireReel(), avantReel);
});

test('écran : accessible, jeton CSRF, aucun script ni style en ligne', async () => {
  const { cookie } = await connexion();
  const r = await obtenir('/interne/soutien', cookie);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /Besoins et collectes/);
  assert.match(html, /name="_csrf" value="[^"]+"/);
  assert.ok(!/<script(?![^>]*src=)/.test(html), 'script en ligne');
  assert.ok(!/<style|style="/.test(html), 'style en ligne');
});

test('CSRF : POST sans jeton ou avec jeton faux → 403, rien d’écrit', async () => {
  const { cookie } = await connexion();
  const avant = contenu.soutien.besoins.length;
  for (const champs of [{ _version: version(), titre: 'Test' }, { _csrf: 'faux', _version: version(), titre: 'Test' }]) {
    assert.equal((await poster('/interne/soutien/besoins', champs, { cookie })).status, 403);
  }
  assert.equal(contenu.soutien.besoins.length, avant);
});

test('besoin : ajout visible sur « Nous soutenir », puis suppression', async () => {
  const { cookie, csrf } = await connexion();
  const ajout = await poster('/interne/soutien/besoins', {
    _csrf: csrf, _version: version(), titre: 'Caisses de transport', detail: 'Toutes tailles, en bon état.',
  }, { cookie });
  assert.equal(ajout.status, 303);
  assert.match(ajout.headers.get('location'), /ok=besoin_ajoute/);

  const ajoute = contenu.soutien.besoins.at(-1);
  assert.equal(ajoute.titre, 'Caisses de transport');
  assert.equal(ajoute.id, 'caisses-de-transport', 'l’identifiant est dérivé du titre');

  // Rechargement à chaud : la page publique le montre sans redémarrage.
  assert.match(await (await obtenir('/nous-soutenir')).text(), /Caisses de transport/);

  // Écriture atomique : aucun fichier temporaire laissé derrière.
  const disque = JSON.parse(readFileSync(join(dossierContenu, 'soutien.json'), 'utf8'));
  assert.equal(disque.besoins.at(-1).titre, 'Caisses de transport');
  assert.deepEqual(readdirSync(dossierContenu).filter((f) => f.endsWith('.tmp')), []);

  const suppr = await poster(`/interne/soutien/besoins/${ajoute.id}/supprimer`, { _csrf: csrf, _version: version() }, { cookie });
  assert.equal(suppr.status, 303);
  assert.ok(!contenu.soutien.besoins.some((b) => b.id === ajoute.id));
  assert.ok(!(await (await obtenir('/nous-soutenir')).text()).includes('Caisses de transport'));
});

test('besoin : titre obligatoire, titre trop long refusé (422)', async () => {
  const { cookie, csrf } = await connexion();
  const avant = contenu.soutien.besoins.length;
  for (const champs of [{ titre: '' }, { titre: 'x'.repeat(121) }, { titre: 'Litière', detail: 'y'.repeat(501) }]) {
    const r = await poster('/interne/soutien/besoins', { _csrf: csrf, _version: version(), ...champs }, { cookie });
    assert.equal(r.status, 422, JSON.stringify(champs));
  }
  assert.equal(contenu.soutien.besoins.length, avant);
});

test('collecte : ajout, masquage automatique des dates passées, suppression', async () => {
  const { cookie, csrf } = await connexion();
  const future = dateDans(30);
  const passee = dateDans(-30);

  assert.equal((await poster('/interne/soutien/collectes', {
    _csrf: csrf, _version: version(), date: future, lieu: 'Animalerie de la Gare', ville: 'Morsang-sur-Orge', horaires: '10 h – 18 h',
  }, { cookie })).status, 303);
  assert.equal((await poster('/interne/soutien/collectes', {
    _csrf: csrf, _version: version(), date: passee, lieu: 'Supermarché du Centre', ville: 'Perpezac-le-Noir',
  }, { cookie })).status, 303);

  const publique = await (await obtenir('/nous-soutenir')).text();
  assert.match(publique, /Animalerie de la Gare/, 'une collecte à venir est affichée');
  assert.ok(!publique.includes('Supermarché du Centre'), 'une collecte passée est masquée automatiquement');

  // L'équipe la voit toujours, signalée comme passée.
  const interne = await (await obtenir('/interne/soutien', cookie)).text();
  assert.match(interne, /Supermarché du Centre/);
  assert.match(interne, /Passée : masquée du site/);

  for (const c of [...contenu.soutien.collectes]) {
    assert.equal((await poster(`/interne/soutien/collectes/${c.id}/supprimer`, { _csrf: csrf, _version: version() }, { cookie })).status, 303);
  }
  assert.equal(contenu.soutien.collectes.length, 0);
});

test('collecte : date et lieu validés (422)', async () => {
  const { cookie, csrf } = await connexion();
  const avant = contenu.soutien.collectes.length;
  for (const champs of [
    { date: '', lieu: 'Magasin' },
    { date: '12/12/2026', lieu: 'Magasin' },
    { date: '2026-13-45', lieu: 'Magasin' },
    { date: dateDans(10), lieu: '' },
    { date: dateDans(10), lieu: 'x'.repeat(121) },
  ]) {
    const r = await poster('/interne/soutien/collectes', { _csrf: csrf, _version: version(), ...champs }, { cookie });
    assert.equal(r.status, 422, JSON.stringify(champs));
  }
  assert.equal(contenu.soutien.collectes.length, avant);
});

test('409 : version périmée refusée ; 422 : version absente', async () => {
  const { cookie, csrf } = await connexion();
  const perimee = String(Number(version()) + 7);
  const r = await poster('/interne/soutien/besoins', { _csrf: csrf, _version: perimee, titre: 'Trop tard' }, { cookie });
  assert.equal(r.status, 409);
  assert.match(await r.text(), /modifié par quelqu’un d’autre/);

  const sans = await poster('/interne/soutien/besoins', { _csrf: csrf, titre: 'Sans version' }, { cookie });
  assert.equal(sans.status, 422);
  assert.ok(!contenu.soutien.besoins.some((b) => b.titre === 'Trop tard' || b.titre === 'Sans version'));
});

test('422 : champ hors liste blanche et clés dangereuses rejetés', async () => {
  const { cookie, csrf } = await connexion();
  const avant = contenu.soutien.besoins.length;
  for (const cle of ['__proto__', 'constructor', 'prototype', 'prix', 'html']) {
    const r = await poster('/interne/soutien/besoins', { _csrf: csrf, _version: version(), titre: 'Litière', [cle]: 'x' }, { cookie });
    assert.equal(r.status, 422, cle);
  }
  assert.equal(contenu.soutien.besoins.length, avant);
  assert.equal(({}).polluee, undefined);
});

test('suppression d’une entrée inexistante : 404, contenu intact', async () => {
  const { cookie, csrf } = await connexion();
  const avant = JSON.stringify(contenu.soutien.besoins);
  assert.equal((await poster('/interne/soutien/besoins/inexistant/supprimer', { _csrf: csrf, _version: version() }, { cookie })).status, 404);
  assert.equal((await poster('/interne/soutien/collectes/inexistante/supprimer', { _csrf: csrf, _version: version() }, { cookie })).status, 404);
  assert.equal(JSON.stringify(contenu.soutien.besoins), avant);
  assert.equal(lireReel(), avantReel);
});
