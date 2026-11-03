/**
 * Statistiques de /interne : compteurs par jour (Europe/Paris), élagage, fenêtres 7/30 jours,
 * échec partiel sans double comptage, absence de cookie public, rendu du tableau de bord.
 * Tout se passe dans des dossiers temporaires.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../../src/server/app.js';
import { chargerContenu } from '../../src/server/content.js';
import { createStore } from '../../src/server/store.js';
import { createSoumissions } from '../../src/server/soumissions.js';
import { createCompteurVues, jourParis, decalerJour } from '../../src/server/vues.js';
import { createSocialRuntime } from '../../src/server/social.js';
import { createPublicRouter } from '../../src/server/routes/public.js';
import { createInterneRouter } from '../../src/server/routes/interne.js';

const SECRET = 'secret-de-test-0123456789abcdef-0123456789abcdef';
const REEL = new URL('../../content/', import.meta.url);
const silence = { info() {}, warn() {}, error() {} };

const dossiers = [];
const temp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); dossiers.push(d); return d; };
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

const lireJours = (dir) => JSON.parse(readFileSync(join(dir, 'vues-jours.json'), 'utf8'));
const lireVues = (dir) => JSON.parse(readFileSync(join(dir, 'vues.json'), 'utf8'));

function compteur({ horloge, store, dir }) {
  const d = dir ?? temp('stats-');
  const s = store ?? createStore({ dir: d });
  const vues = createCompteurVues({ store: s, flushMs: 60_000, logger: silence, now: () => horloge.t });
  return { vues, dir: d, store: s };
}

test('passage de minuit à Paris : le jour est figé à l’incrément, pas au flush', async () => {
  const h = { t: Date.parse('2026-06-30T21:59:59Z') }; // 23:59:59 à Paris (heure d’été)
  const { vues, dir } = compteur({ horloge: h });
  await vues.charger();
  vues.incrementer('biscotte');
  h.t = Date.parse('2026-06-30T22:00:00Z'); // 00:00:00 le 1er juillet
  vues.incrementer('biscotte');
  h.t = Date.parse('2026-07-02T10:00:00Z'); // flush bien plus tard
  await vues.flush();
  assert.deepEqual(lireJours(dir), { '2026-06-30': 1, '2026-07-01': 1 });
  assert.equal(jourParis(Date.parse('2026-12-31T23:30:00Z')), '2027-01-01'); // hiver : UTC+1
});

test('changement d’heure : fenêtres en jours calendaires (printemps et automne)', async () => {
  // Printemps : le 29/03/2026 ne dure que 23 h.
  const h = { t: Date.parse('2026-03-28T23:30:00Z') }; // 00:30 le 29 à Paris
  const { vues } = compteur({ horloge: h });
  await vues.charger();
  vues.incrementer('a');
  h.t = Date.parse('2026-03-28T22:30:00Z'); // 23:30 le 28
  vues.incrementer('a');
  h.t = Date.parse('2026-03-29T22:30:00Z'); // 00:30 le 30 (UTC+2)
  vues.incrementer('a');
  assert.equal(vues.totauxSur(1), 1); // le 30 seul
  assert.equal(vues.totauxSur(2), 2); // 30 + 29
  assert.equal(vues.totauxSur(3), 3);
  // Automne : le 25/10/2026 dure 25 h ; 7 jours = 19..25 inclus.
  const h2 = { t: Date.parse('2026-10-18T10:00:00Z') };
  const c2 = compteur({ horloge: h2 });
  await c2.vues.charger();
  c2.vues.incrementer('a'); // le 18 : hors fenêtre de 7 jours terminée le 25
  h2.t = Date.parse('2026-10-19T10:00:00Z');
  c2.vues.incrementer('a'); // le 19 : premier jour de la fenêtre
  h2.t = Date.parse('2026-10-25T23:30:00Z'); // 00:30 le 26 en hiver (UTC+1)... fenêtre 20..26
  assert.equal(jourParis(h2.t), '2026-10-26');
  assert.equal(c2.vues.totauxSur(7), 0);
  h2.t = Date.parse('2026-10-25T10:00:00Z'); // le 25
  assert.equal(c2.vues.totauxSur(7), 1); // le 19 inclus, le 18 exclu
  assert.equal(decalerJour('2026-03-29', 1), '2026-03-30');
  assert.equal(decalerJour('2026-10-25', -6), '2026-10-19');
});

test('bornes des fenêtres 7 et 30 jours (J à J-6, J à J-29)', async () => {
  const h = { t: Date.parse('2026-07-15T10:00:00Z') };
  const dir = temp('stats-');
  const jours = {};
  for (let i = 0; i <= 31; i += 1) jours[decalerJour('2026-07-15', -i)] = 1;
  writeFileSync(join(dir, 'vues-jours.json'), JSON.stringify(jours));
  const { vues } = compteur({ horloge: h, dir });
  await vues.charger();
  assert.equal(vues.totauxSur(7), 7);
  assert.equal(vues.totauxSur(30), 30);
  assert.equal(vues.totauxSur(1), 1);
  h.t = Date.parse('2026-07-16T10:00:00Z'); // le lendemain : la fenêtre glisse
  assert.equal(vues.totauxSur(7), 6);
});

test('élagage à 31 jours calendaires et clés non conformes ignorées', async () => {
  const h = { t: Date.parse('2026-07-31T10:00:00Z') };
  const dir = temp('stats-');
  writeFileSync(join(dir, 'vues-jours.json'), JSON.stringify({
    '2026-06-30': 5, '2026-07-01': 2, 'abc': 9, '2026-02-31': 4, '2026-7-1': 3, '__proto__x': 1,
  }));
  const { vues } = compteur({ horloge: h, dir });
  await vues.charger();
  assert.equal(vues.totauxSur(60), 2); // seuls les jours conformes et récents comptent
  vues.incrementer('a');
  await vues.flush();
  assert.deepEqual(lireJours(dir), { '2026-07-01': 2, '2026-07-31': 1 });
});

test('échec partiel : aucune double comptabilisation après relance', async () => {
  for (const cible of ['vues', 'vues-jours']) {
    const h = { t: Date.parse('2026-07-10T10:00:00Z') };
    const dir = temp('stats-');
    const reel = createStore({ dir });
    let echecs = 1;
    const store = { ...reel, read: reel.read, update: (nom, fn, fb) => {
      if (nom === cible && echecs-- > 0) return Promise.reject(new Error('disque plein'));
      return reel.update(nom, fn, fb);
    } };
    const { vues } = compteur({ horloge: h, store, dir });
    await vues.charger();
    vues.incrementer('biscotte');
    vues.incrementer('biscotte');
    await vues.flush(); // une collection échoue, l’autre passe
    await vues.flush(); // relance
    await vues.flush(); // flush supplémentaire : ne doit rien rejouer
    assert.deepEqual(lireVues(dir), { biscotte: 2 }, cible);
    assert.deepEqual(lireJours(dir), { '2026-07-10': 2 }, cible);
    assert.equal(vues.totauxSur(7), 2);
    assert.deepEqual(vues.tous(), { biscotte: 2 });
  }
});

test('charger / stop couvrent les deux collections', async () => {
  const h = { t: Date.parse('2026-07-10T10:00:00Z') };
  const dir = temp('stats-');
  const a = compteur({ horloge: h, dir });
  await a.vues.charger();
  a.vues.incrementer('x');
  await a.vues.stop();
  assert.ok(existsSync(join(dir, 'vues.json')) && existsSync(join(dir, 'vues-jours.json')));
  const b = compteur({ horloge: h, dir });
  await b.vues.charger();
  assert.equal(b.vues.totauxSur(7), 1);
  assert.deepEqual(b.vues.tous(), { x: 1 });
});

// ── Routes ───────────────────────────────────────────────────────────────────
let dossier; let dossierContenu; let serveur; let origine; let contenu; let vues; let social; let soumissions;
const horloge = { t: Date.parse('2026-07-10T10:00:00Z') };

before(async () => {
  dossier = temp('stats-donnees-');
  dossierContenu = temp('stats-contenu-');
  cpSync(new URL('.', REEL), dossierContenu, { recursive: true });
  contenu = chargerContenu({ dir: dossierContenu });
  const store = createStore({ dir: dossier });
  soumissions = createSoumissions({ store });
  vues = createCompteurVues({ store, flushMs: 60_000, logger: silence, now: () => horloge.t });
  await vues.charger();
  social = createSocialRuntime({ env: { SOCIAL_MODE: 'simulation' }, dataDir: dossier, logger: silence, getAnimaux: () => contenu.animaux, getVues: () => vues.tous(), getSeuil: () => 5 });
  const app = createApp({
    logger: silence,
    mount(a) {
      a.use('/interne', createInterneRouter({ contenu, soumissions, vues, social, secret: SECRET, seuil: 5, logger: silence }));
      a.use(createPublicRouter({ contenu, soumissions, vues, baseUrl: 'http://127.0.0.1', secret: SECRET, logger: silence }));
    },
  });
  serveur = app.listen(0, '127.0.0.1');
  await new Promise((ok) => serveur.once('listening', ok));
  origine = `http://127.0.0.1:${serveur.address().port}`;
});
after(async () => {
  social?.stop();
  await vues?.stop();
  await new Promise((ok) => serveur.close(ok));
});

async function connexion() {
  const r = await fetch(`${origine}/interne/connexion`, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origine },
    body: new URLSearchParams({ secret: SECRET }),
  });
  return r.headers.get('set-cookie').split(';')[0];
}

test('route publique de fiche : compte la vue sans poser de cookie', async () => {
  const slug = contenu.disponibles[0].slug;
  const avant = vues.totauxSur(7);
  const r = await fetch(`${origine}/animaux/${slug}`, { redirect: 'manual' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('set-cookie'), null);
  assert.equal(vues.totauxSur(7), avant + 1);
});

test('tableau de bord : vues 7/30 jours, demandes par fiche, non rattachées, fiches sans demande', async () => {
  const [a, b] = contenu.disponibles;
  await soumissions.ajouter('interet', { animalSlug: a.slug, animal: a.nom });
  await soumissions.ajouter('interet', { animalSlug: a.slug, animal: a.nom });
  await soumissions.ajouter('interet', { animal: 'Inconnu' }); // slug absent
  await soumissions.ajouter('interet', { animalSlug: 'fiche-disparue' }); // slug inconnu
  const cookie = await connexion();
  const r = await fetch(`${origine}/interne`, { headers: { Cookie: cookie } });
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /7 derniers jours[^<]*<strong>1<\/strong>/);
  assert.match(html, /30 derniers jours[^<]*<strong>1<\/strong>/);
  assert.match(html, /Non rattachées à une fiche[^<]*<strong>2<\/strong>/);
  assert.match(html, /Fiches disponibles sans aucune demande/);
  // a a 2 demandes (n’est pas dans la liste « sans demande »), b en a 0
  const sans = html.slice(html.indexOf('sans aucune demande'), html.indexOf('titre-classement'));
  assert.ok(sans.includes(`/animaux/${b.slug}`));
  assert.ok(!sans.includes(`/animaux/${a.slug}"`));
  assert.match(html, /Classement des fiches par consultations/); // existant conservé
  assert.match(html, /Sous le seuil/);
  assert.match(html, />Demandes</);
});
