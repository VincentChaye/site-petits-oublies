/**
 * Connexion interne durcie : limiteur d'échecs uniquement, 429 générique,
 * régénération de session, message unique, journal sans donnée sensible.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../../src/server/app.js';
import { chargerContenu } from '../../src/server/content.js';
import { createStore } from '../../src/server/store.js';
import { createSoumissions } from '../../src/server/soumissions.js';
import { createCompteurVues } from '../../src/server/vues.js';
import { createSocialRuntime } from '../../src/server/social.js';
import { createPublicRouter } from '../../src/server/routes/public.js';
import { createInterneRouter, MESSAGE_SECRET_INVALIDE, MESSAGE_BLOCAGE } from '../../src/server/routes/interne.js';
import { createFailureLimiter } from '../../src/security/antispam.js';
import { escapeCsvField } from '../../src/security/csv.js';

const SECRET = 'secret-de-test-0123456789abcdef-0123456789abcdef';
const MAUVAIS = 'mauvais-secret-saisi-xyz';
const MAX = 3;
const REEL = new URL('../../content/', import.meta.url);
const ENV = { SOCIAL_MODE: 'simulation', SOCIAL_FACEBOOK_ENABLED: 'true', SOCIAL_FACEBOOK_API_KEY: 'cle-de-test', SOCIAL_SITE_URL: 'http://127.0.0.1' };

let dossier; let dossierContenu; let serveur; let origine; let vues;
const journal = [];
const logger = { error: (m) => journal.push(String(m)), warn: (m) => journal.push(String(m)), info: (m) => journal.push(String(m)) };

const poster = (secret, cookie) => fetch(`${origine}/interne/connexion`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origine, ...(cookie ? { Cookie: cookie } : {}) },
  body: new URLSearchParams({ secret }),
  redirect: 'manual',
});
const sid = (r) => r.headers.get('set-cookie')?.split(';')[0];
const csrfDe = async (cookie) => /name="_csrf" value="([^"]+)"/.exec(await (await fetch(`${origine}/interne`, { headers: { Cookie: cookie }, redirect: 'manual' })).text())?.[1];

async function demarrer(options) {
  const app = createApp({
    logger,
    mount(a) {
      a.use('/interne', createInterneRouter({ contenu: chargerContenu({ dir: dossierContenu }), soumissions: createSoumissions({ store: createStore({ dir: dossier }) }), vues, social: createSocialRuntime({ env: ENV, dataDir: dossier, logger: { info() {}, warn() {}, error() {} }, getAnimaux: () => [], getVues: () => ({}), getSeuil: () => 5 }), secret: SECRET, logger, maxEchecs: MAX, ...options }));
      a.use(createPublicRouter({ contenu: chargerContenu({ dir: dossierContenu }), soumissions: createSoumissions({ store: createStore({ dir: dossier }) }), vues, baseUrl: 'http://127.0.0.1', secret: SECRET, logger }));
    },
  });
  serveur = app.listen(0, '127.0.0.1');
  await new Promise((ok) => serveur.once('listening', ok));
  origine = `http://127.0.0.1:${serveur.address().port}`;
}

before(async () => {
  dossier = mkdtempSync(join(tmpdir(), 'cx-donnees-'));
  dossierContenu = mkdtempSync(join(tmpdir(), 'cx-contenu-'));
  cpSync(new URL('.', REEL), dossierContenu, { recursive: true });
  vues = createCompteurVues({ store: createStore({ dir: dossier }), flushMs: 5 });
  await vues.charger();
});
after(async () => {
  await new Promise((ok) => serveur?.close(ok));
  await vues?.flush?.();
  rmSync(dossier, { recursive: true, force: true });
  rmSync(dossierContenu, { recursive: true, force: true });
});

test('succès non comptés, puis échecs bloqués après N essais (429 générique)', async () => {
  await demarrer();
  // Beaucoup plus de succès que le quota : jamais bloqué.
  for (let i = 0; i < MAX * 3; i += 1) assert.equal((await poster(SECRET)).status, 303);
  // N échecs consécutifs : 401 avec le message unique.
  for (let i = 0; i < MAX; i += 1) {
    const r = await poster(MAUVAIS);
    assert.equal(r.status, 401);
    assert.ok((await r.text()).includes(MESSAGE_SECRET_INVALIDE));
  }
  // Bloqué : même le bon secret est refusé, message générique sans durée.
  const bloque = await poster(SECRET);
  assert.equal(bloque.status, 429);
  const html = await bloque.text();
  assert.ok(html.includes(MESSAGE_BLOCAGE));
  assert.doesNotMatch(html, /\d+ seconde/);
  assert.ok(bloque.headers.get('retry-after'));
  assert.equal(bloque.headers.get('set-cookie'), null);
});

test('un succès réinitialise le compteur d’échecs', async () => {
  serveur.close();
  await demarrer();
  for (let i = 0; i < MAX - 1; i += 1) await poster(MAUVAIS);
  assert.equal((await poster(SECRET)).status, 303);
  for (let i = 0; i < MAX - 1; i += 1) assert.equal((await poster(MAUVAIS)).status, 401);
  assert.equal((await poster(SECRET)).status, 303);
});

test('message de secret invalide identique quel que soit l’échec', async () => {
  serveur.close();
  await demarrer();
  const a = await (await poster(MAUVAIS)).text();
  const b = await (await poster('')).text();
  assert.ok(a.includes(MESSAGE_SECRET_INVALIDE));
  assert.ok(b.includes(MESSAGE_SECRET_INVALIDE));
  assert.doesNotMatch(a, /incorrect|trop court|vide/i);
});

test('connexion réussie : nouvel identifiant, ancien invalide, nouveau jeton CSRF', async () => {
  serveur.close();
  await demarrer();
  const c1 = sid(await poster(SECRET));
  const csrf1 = await csrfDe(c1);
  assert.ok(csrf1);
  const r2 = await poster(SECRET, c1); // reconnexion avec l'ancien cookie
  const c2 = sid(r2);
  assert.notEqual(c1, c2);
  assert.equal((await fetch(`${origine}/interne`, { headers: { Cookie: c1 }, redirect: 'manual' })).status, 303); // ancien refusé
  const csrf2 = await csrfDe(c2);
  assert.ok(csrf2);
  assert.notEqual(csrf1, csrf2);
});

test('journal : événements présents, sans secret, IP, cookie ni jeton', async () => {
  serveur.close();
  journal.length = 0;
  await demarrer();
  for (let i = 0; i < MAX; i += 1) await poster(MAUVAIS);
  await poster(MAUVAIS); // blocage
  const ok = await poster('autre-chose');
  assert.equal(ok.status, 429);
  const texte = journal.join('\n');
  assert.match(texte, /connexion_echec/);
  assert.match(texte, /connexion_bloquee/);
  assert.ok(!texte.includes(MAUVAIS));
  assert.ok(!texte.includes(SECRET));
  assert.doesNotMatch(texte, /127\.0\.0\.1|::1|::ffff|sid=/);
  serveur.close();
});

test('limiteur d’échecs : fenêtre expirée libère la clé, reset efface', () => {
  let t = 0;
  const l = createFailureLimiter({ max: 2, windowMs: 1000, now: () => t });
  l.recordFailure('a'); l.recordFailure('a');
  assert.equal(l.status('a').blocked, true);
  assert.equal(l.status('b').blocked, false);
  t = 1500;
  assert.equal(l.status('a').blocked, false);
  l.recordFailure('a'); l.recordFailure('a');
  l.reset('a');
  assert.equal(l.status('a').blocked, false);
});

test('CSV : cellules à déclencheur neutralisées, y compris après espaces', () => {
  for (const v of ['=1+1', '+1', '-1', '@x', '\tx', '\rx', '  =1', ' \t@x']) {
    assert.ok(escapeCsvField(v).replace(/^"/, '').startsWith("'"), JSON.stringify(v));
  }
  assert.equal(escapeCsvField('bonjour'), 'bonjour');
});
