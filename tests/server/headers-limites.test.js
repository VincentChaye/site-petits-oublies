/**
 * Non-régression : en-têtes no-store/noindex sur /interne et l'export CSV,
 * limites de corps (20 ko, 100 paramètres), CSRF sur POST d'édition, liste blanche des champs.
 * Contenu copié dans un dossier temporaire : content/ réel jamais écrit.
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
import { createInterneRouter } from '../../src/server/routes/interne.js';

const SECRET = 'secret-de-test-0123456789abcdef-0123456789abcdef';
const ENV = { SOCIAL_MODE: 'simulation', SOCIAL_FACEBOOK_ENABLED: 'true', SOCIAL_FACEBOOK_API_KEY: 'cle-de-test', SOCIAL_SITE_URL: 'http://127.0.0.1' };
const REEL = new URL('../../content/', import.meta.url);

let dossier; let dossierContenu; let serveur; let origine; let contexte; let contenu;

const poster = (chemin, corps, { cookie } = {}) => fetch(`${origine}${chemin}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origine, ...(cookie ? { Cookie: cookie } : {}) },
  body: typeof corps === 'string' ? corps : new URLSearchParams(Object.entries(corps)),
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
  dateArrivee: '2026-10-01', statut: 'disponible', caractere: 'Douce.', besoins: 'Un foyer calme.', histoire: 'Trouvée.',
  photo_src: '', photo_alt: '', ...extra,
});

const verifierEntetes = (r, msg) => {
  assert.equal(r.headers.get('cache-control'), 'no-store', msg);
  assert.match(r.headers.get('x-robots-tag') ?? '', /noindex/, msg);
};

before(async () => {
  dossier = mkdtempSync(join(tmpdir(), 'hl-donnees-'));
  dossierContenu = mkdtempSync(join(tmpdir(), 'hl-contenu-'));
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

test('en-têtes no-store/noindex : connexion, redirections, pages, 404 et CSV sous /interne', async () => {
  verifierEntetes(await obtenir('/interne/connexion'), 'connexion');
  const redir = await obtenir('/interne');
  assert.equal(redir.status, 303);
  verifierEntetes(redir, 'redirection');
  const { cookie } = await connexion();
  verifierEntetes(await obtenir('/interne', cookie), 'tableau de bord');
  verifierEntetes(await obtenir('/interne/animaux', cookie), 'animaux');
  verifierEntetes(await obtenir('/interne/inexistant', cookie), '404 interne');
  const csv = await obtenir('/interne/soumissions/export.csv?type=contact', cookie);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  verifierEntetes(csv, 'export CSV');
});

test('le site public n’est pas concerné par no-store et la CSP reste sans unsafe-inline', async () => {
  const r = await obtenir('/');
  assert.notEqual(r.headers.get('cache-control'), 'no-store');
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.doesNotMatch(r.headers.get('content-security-policy'), /unsafe-inline/);
});

test('corps > 20 ko -> 413 propre, sans pile, en-têtes internes conservés', async () => {
  const r = await poster('/interne/connexion', `secret=${'a'.repeat(21 * 1024)}`);
  assert.equal(r.status, 413);
  assert.doesNotMatch(await r.text(), /\sat\s|node_modules|\.js:\d+/);
  verifierEntetes(r, '413');
});

test('trop de paramètres -> 413 propre', async () => {
  const corps = Array.from({ length: 150 }, (_, i) => `p${i}=1`).join('&');
  const r = await poster('/interne/connexion', corps);
  assert.equal(r.status, 413);
  assert.doesNotMatch(await r.text(), /\sat\s|node_modules|\.js:\d+/);
});

test('POST d’édition sans jeton CSRF -> 403, rien d’écrit', async () => {
  const { cookie } = await connexion();
  const avant = JSON.stringify(contenu.animal('biscotte'));
  const r = await poster('/interne/animaux/biscotte/modifier', { ...fiche('biscotte'), nom: 'Pirate', _version: '0' }, { cookie });
  assert.equal(r.status, 403);
  assert.equal(JSON.stringify(contenu.animal('biscotte')), avant);
});

test('champ hors liste blanche : jamais persisté (la saisie est refusée en 422)', async () => {
  const { cookie, csrf } = await connexion();
  const r = await poster('/interne/animaux/nouveau', { ...fiche('liste-blanche'), _csrf: csrf, admin: 'oui', notes_internes: 'x' }, { cookie });
  assert.equal(r.status, 422);
  assert.equal(contenu.animal('liste-blanche'), undefined);
  // Sans le champ en trop, la même fiche passe et ne contient que des clés connues.
  const ok = await poster('/interne/animaux/nouveau', { ...fiche('liste-blanche'), _csrf: csrf }, { cookie });
  assert.equal(ok.status, 303);
  const a = contenu.animal('liste-blanche');
  assert.equal(a.admin, undefined);
  assert.equal(a.notes_internes, undefined);
});
