/**
 * Tests des routes /interne/conseils : CSRF, validation des sections (422),
 * versions (409), clés interdites, et scénario créer → visible sur /conseils
 * sans redémarrage → modifier → supprimer.
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

const lireReel = () => readFileSync(new URL('conseils.json', REEL), 'utf8');

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

const SECTIONS = [
  'texte: Pourquoi un bac à litière propre',
  'Un chat refuse une litière sale : il ira ailleurs, et ce n’est pas de la vengeance.',
  '---',
  'saviez_vous: Le saviez-vous ?',
  'Un chat passe jusqu’à cinq heures par jour à faire sa toilette.',
  '---',
  'probleme: Problème 1 : un seul bac pour plusieurs chats',
  'Les chats n’aiment pas partager leur bac.',
  'Conseil : prévoir un bac par chat, plus un.',
  '---',
  'liste: À retenir',
  '- Un bac par chat, plus un',
  '- Nettoyage quotidien',
].join('\n');

const fiche = (extra = {}) => ({
  slug: 'litiere-du-chat', titre: 'La litière du chat', resume: 'Combien de bacs, où les placer, à quelle fréquence les nettoyer.',
  icone: 'chat', outil: '', sections: SECTIONS, ...extra,
});

before(async () => {
  avantReel = lireReel();
  dossier = mkdtempSync(join(tmpdir(), 'conseils-donnees-'));
  dossierContenu = mkdtempSync(join(tmpdir(), 'conseils-contenu-'));
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

test('isolation : content/conseils.json réel jamais modifié', () => {
  assert.equal(contenu.dossier, dossierContenu);
  assert.equal(lireReel(), avantReel);
});

test('écrans : liste et formulaires accessibles, jeton CSRF, aucun script ni style en ligne', async () => {
  const { cookie } = await connexion();
  for (const chemin of ['/interne/conseils', '/interne/conseils/nouveau', '/interne/conseils/alimentation-du-chat/modifier']) {
    const r = await obtenir(chemin, cookie);
    assert.equal(r.status, 200, chemin);
    const html = await r.text();
    assert.match(html, /name="_csrf" value="[^"]+"/, `${chemin} : jeton CSRF absent`);
    assert.ok(!/<script(?![^>]*src=)/.test(html), `${chemin} : script en ligne`);
    assert.ok(!/<style|style="/.test(html), `${chemin} : style en ligne`);
    assert.ok(!html.includes('href="/interne"') || chemin.startsWith('/interne'), 'écran interne');
  }
});

test('CSRF : POST sans jeton ou avec jeton faux → 403, rien d’écrit', async () => {
  const { cookie } = await connexion();
  const avant = contenu.conseils.length;
  for (const champs of [fiche(), { ...fiche(), _csrf: 'faux' }]) {
    assert.equal((await poster('/interne/conseils/nouveau', champs, { cookie })).status, 403);
  }
  assert.equal((await poster('/interne/conseils/alimentation-du-chat/supprimer', { _version: '1' }, { cookie })).status, 403);
  assert.equal(contenu.conseils.length, avant);
});

test('scénario : créer une fiche, la voir sur /conseils sans redémarrage, la modifier', async () => {
  const { cookie, csrf } = await connexion();
  const cree = await poster('/interne/conseils/nouveau', { _csrf: csrf, ...fiche() }, { cookie });
  assert.equal(cree.status, 303);
  assert.match(cree.headers.get('location'), /ok=cree/);

  // Rechargement à chaud : la page publique montre la fiche sans redémarrage.
  const index = await (await obtenir('/conseils')).text();
  assert.match(index, /La litière du chat/);
  const page = await obtenir('/conseils/litiere-du-chat');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Problème 1 : un seul bac/);
  assert.match(html, /prévoir un bac par chat/);
  assert.match(html, /Un chat passe jusqu’à cinq heures/);
  assert.match(html, /Nettoyage quotidien/);
  assert.ok(!html.includes('/js/conseils.js'), 'aucun outil déclaré : le script n’est pas chargé');

  // Sitemap : la fiche y entre aussitôt.
  assert.match(await (await obtenir('/sitemap.xml')).text(), /\/conseils\/litiere-du-chat</);

  // Écriture atomique : aucun fichier temporaire laissé derrière.
  const disque = JSON.parse(readFileSync(join(dossierContenu, 'conseils.json'), 'utf8'));
  assert.equal(disque.at(-1).slug, 'litiere-du-chat');
  assert.equal(disque.at(-1)._version, 1);
  assert.deepEqual(readdirSync(dossierContenu).filter((f) => f.endsWith('.tmp')), []);

  const form = await (await obtenir('/interne/conseils/litiere-du-chat/modifier', cookie)).text();
  assert.match(form, /name="_version" value="1"/);
  assert.match(form, /Problème 1 : un seul bac/, 'les sections sont rendues dans le formulaire');

  const modif = await poster('/interne/conseils/litiere-du-chat/modifier', {
    _csrf: csrf, ...fiche({ titre: 'La litière, mode d’emploi' }), _version: '1',
  }, { cookie });
  assert.equal(modif.status, 303);
  assert.equal(contenu.conseil('litiere-du-chat').titre, 'La litière, mode d’emploi');
  assert.equal(contenu.conseil('litiere-du-chat')._version, 2);
  assert.equal(lireReel(), avantReel, 'le content/ réel reste intact');
});

test('409 : version périmée sur modification et suppression, rien d’écrit', async () => {
  const { cookie, csrf } = await connexion();
  const m = await poster('/interne/conseils/litiere-du-chat/modifier', { _csrf: csrf, ...fiche({ titre: 'Périmée' }), _version: '1' }, { cookie });
  assert.equal(m.status, 409);
  assert.match(await m.text(), /modifiée par quelqu’un d’autre/);

  const s = await poster('/interne/conseils/litiere-du-chat/supprimer', { _csrf: csrf, _version: '1' }, { cookie });
  assert.equal(s.status, 409);
  assert.ok(contenu.conseil('litiere-du-chat'), 'la fiche doit toujours exister');
  assert.equal(contenu.conseil('litiere-du-chat').titre, 'La litière, mode d’emploi');
});

test('422 : slug, titre, résumé, outil et sections validés', async () => {
  const { cookie, csrf } = await connexion();
  const avant = contenu.conseils.length;
  const cas = [
    ['slug absent', fiche({ slug: '' })],
    ['slug invalide', fiche({ slug: 'Litière Du Chat' })],
    ['slug en doublon', fiche({ slug: 'alimentation-du-chat' })],
    ['titre absent', fiche({ titre: '' })],
    ['résumé absent', fiche({ resume: '' })],
    ['outil inconnu', fiche({ slug: 'autre-fiche', outil: 'convertisseur' })],
    ['sections vides', fiche({ slug: 'autre-fiche', sections: '   ' })],
    ['type de section inconnu', fiche({ slug: 'autre-fiche', sections: 'citation: Untel\nUn texte.' })],
    ['problème sans titre', fiche({ slug: 'autre-fiche', sections: 'probleme:\nUn texte.' })],
    ['liste vide', fiche({ slug: 'autre-fiche', sections: 'liste: À retenir' })],
  ];
  for (const [nom, champs] of cas) {
    const r = await poster('/interne/conseils/nouveau', { _csrf: csrf, ...champs }, { cookie });
    assert.equal(r.status, 422, nom);
  }
  assert.equal(contenu.conseils.length, avant, 'aucune fiche ne doit avoir été créée');
});

test('422 : champs hors liste blanche et clés __proto__ / constructor rejetés', async () => {
  const { cookie, csrf } = await connexion();
  const avant = contenu.conseils.length;
  for (const cle of ['__proto__', 'constructor', 'prototype', 'auteur', 'html', '_version2']) {
    const r = await poster('/interne/conseils/nouveau', { _csrf: csrf, ...fiche({ slug: 'cle-interdite' }), [cle]: 'x' }, { cookie });
    assert.equal(r.status, 422, cle);
    assert.match(await r.text(), /non autorisé|interdit/, cle);
  }
  assert.equal(contenu.conseils.length, avant);
  assert.equal(({}).polluee, undefined);
  assert.equal(contenu.conseil('cle-interdite'), undefined);
});

test('aucun HTML libre : le texte saisi est échappé à l’affichage', async () => {
  const { cookie, csrf } = await connexion();
  const charge = '<script>alert(1)</script>';
  const r = await poster('/interne/conseils/nouveau', {
    _csrf: csrf, ...fiche({ slug: 'echappement', titre: `Titre ${charge}`, sections: `texte: Section ${charge}\nCorps ${charge}` }),
  }, { cookie });
  assert.equal(r.status, 303);
  const html = await (await obtenir('/conseils/echappement')).text();
  assert.ok(!html.includes('<script>alert(1)</script>'), 'le HTML saisi ne doit jamais être rendu tel quel');
  assert.match(html, /&lt;script&gt;/);
});

test('suppression : la fiche disparaît du site et du sitemap', async () => {
  const { cookie, csrf } = await connexion();
  const v = contenu.conseil('litiere-du-chat')._version;
  const r = await poster('/interne/conseils/litiere-du-chat/supprimer', { _csrf: csrf, _version: String(v) }, { cookie });
  assert.equal(r.status, 303);
  assert.match(r.headers.get('location'), /ok=supprime/);
  assert.equal(contenu.conseil('litiere-du-chat'), undefined);
  assert.equal((await obtenir('/conseils/litiere-du-chat')).status, 404);
  assert.ok(!(await (await obtenir('/sitemap.xml')).text()).includes('/conseils/litiere-du-chat<'));

  assert.equal((await poster('/interne/conseils/inconnue/supprimer', { _csrf: csrf, _version: '0' }, { cookie })).status, 404);
  assert.equal((await poster('/interne/conseils/echappement/supprimer', { _csrf: csrf }, { cookie })).status, 422, 'version absente');
});
