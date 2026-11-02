import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSocialRuntime, chargerGabarits } from '../../src/server/social.js';

const SOCIAL_JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'server', 'social.js');
const DAY = 86_400_000;
const NOW = Date.parse('2026-06-15T10:00:00.000Z');
const CLE = 'cle-factice-ABCDEF123456';
const PLATEFORMES = ['facebook', 'instagram', 'x', 'linkedin'];

// Env isolé (jamais process.env) : 4 réseaux activés, clés factices, simulation.
const envBase = (extra = {}) => ({
  SOCIAL_MODE: 'simulation',
  ...Object.fromEntries(PLATEFORMES.flatMap((p) => [[`SOCIAL_${p.toUpperCase()}_ENABLED`, 'true'], [`SOCIAL_${p.toUpperCase()}_API_KEY`, CLE]])),
  ...extra,
});

const silencieux = { log() {}, info() {}, warn() {}, error() {} };
const iso = (joursAvant) => new Date(NOW - joursAvant * DAY).toISOString();
const animal = (slug, nom, statut, joursAvant) => ({
  slug, nom, espece: 'chat', statut, dateArrivee: iso(joursAvant), photos: [`/img/${slug}.jpg`],
});

function creer(dataDir, { animaux, vues = {}, seuil = 5, env = envBase(), logger = silencieux } = {}) {
  return createSocialRuntime({
    env, dataDir, logger, now: () => NOW,
    getAnimaux: () => animaux, getVues: () => vues, getSeuil: () => seuil,
  });
}

function avecDossier(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'social-'));
  const fin = () => rmSync(dir, { recursive: true, force: true });
  let r;
  try { r = fn(dir); } catch (e) { fin(); throw e; }
  return Promise.resolve(r).finally(fin);
}

// Jeu standard : un animal par déclencheur.
const NOUVEAU = animal('milo-chat', 'Milo', 'disponible', 5); // arrivée < 14 j
const DISCRET = animal('luna-chat', 'Luna', 'disponible', 100); // vues 0 < seuil
const ANCIEN = animal('felix-chat', 'Felix', 'disponible', 200); // vues élevées, > 30 j
const VUES = { 'milo-chat': 100, 'luna-chat': 0, 'felix-chat': 100 };
const JEU = { animaux: [NOUVEAU, DISCRET, ANCIEN], vues: VUES };

test('1. les 3 déclencheurs créent des posts (4 réseaux chacun)', () => avecDossier((dir) => {
  const rt = creer(dir, JEU);
  const res = rt.scan();
  assert.equal(res.ok, true);
  assert.deepEqual(res.errors, []);
  const parDecl = (t) => res.created.filter((p) => p.trigger === t);
  for (const [t, slug] of [['arrivee', 'milo-chat'], ['peu_consulte', 'luna-chat'], ['relance_periodique', 'felix-chat']]) {
    const ps = parDecl(t);
    assert.equal(ps.length, 4, `déclencheur ${t}`);
    assert.deepEqual(ps.map((p) => p.animalId), Array(4).fill(slug));
    assert.deepEqual(ps.map((p) => p.platform).sort(), [...PLATEFORMES].sort());
  }
  assert.equal(rt.service.list().length, 12);
  assert.ok(rt.service.list().every((p) => p.status === 'en_validation'));
}));

test('1b. animal arrivé hors fenêtre de 14 jours : pas de déclencheur arrivee', () => avecDossier((dir) => {
  const rt = creer(dir, { animaux: [animal('vieux-chat', 'Vieux', 'disponible', 15)], vues: { 'vieux-chat': 100 } });
  const res = rt.scan();
  assert.equal(res.created.filter((p) => p.trigger === 'arrivee').length, 0);
}));

test('2. anti-doublon persisté : nouveau runtime sur le même dataDir, 0 création', () => avecDossier((dir) => {
  const premier = creer(dir, JEU).scan();
  assert.equal(premier.created.length, 12);
  const total = JSON.parse(readFileSync(path.join(dir, 'social', 'posts.json'), 'utf8')).posts.length;
  assert.equal(total, 12);

  const rt2 = creer(dir, JEU);
  assert.equal(rt2.service.list().length, 12, 'posts rechargés depuis le disque');
  const second = rt2.scan();
  assert.equal(second.ok, true);
  assert.equal(second.created.length, 0);
  assert.equal(rt2.service.list().length, 12);
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'social', 'posts.json'), 'utf8')).posts.length, 12);
}));

test('3. un animal au statut adopte ne génère aucun post', () => avecDossier((dir) => {
  const adopte = animal('rex-chien', 'Rex', 'adopte', 3); // récent, peu vu, ancien : tout déclencheur possible
  const rt = creer(dir, { animaux: [adopte], vues: { 'rex-chien': 0 } });
  const res = rt.scan();
  assert.equal(res.ok, true);
  assert.equal(res.created.length, 0);
  assert.equal(rt.service.list().length, 0);
  const majuscule = creer(dir, { animaux: [{ ...adopte, statut: 'Adopte' }], vues: { 'rex-chien': 0 } }).scan();
  assert.equal(majuscule.created.length, 0);
}));

test('4. vrais gabarits : pas de [REPLI], formulation du JSON, templatesSource = injecte', () => avecDossier((dir) => {
  const rt = creer(dir, JEU);
  const res = rt.scan();
  assert.equal(rt.service.info().templatesSource, 'injecte');
  assert.ok(res.created.length > 0);
  for (const p of rt.service.list()) assert.ok(!p.text.includes('[REPLI]'), p.text);

  const g = chargerGabarits();
  for (const d of ['arrivee', 'peu_consulte', 'relance_periodique']) {
    for (const r of PLATEFORMES) assert.ok(g[d][r].length > 0 && !g[d][r].includes('[REPLI]'));
  }
  const fb = res.created.find((p) => p.trigger === 'arrivee' && p.platform === 'facebook');
  assert.match(fb.text, /Nouvelle arrivée au Refuge des Quatre Vents/);
  assert.match(fb.text, /cherche une famille/);
  assert.match(fb.text, /#adoptezpasachetez/);
  assert.ok(fb.text.includes('Milo'));
  assert.ok(!/\{(nom|espece|url)\}/.test(fb.text), 'variables toutes remplacées');
}));

test('4b. chargerGabarits lève si un gabarit manque (pas de repli silencieux)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'social-gab-'));
  try {
    assert.throws(() => chargerGabarits(path.join(dir, 'inexistant.json')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('5. le texte contient le lien /animaux/<slug>', () => avecDossier((dir) => {
  const rt = creer(dir, JEU);
  rt.scan();
  const attendu = { arrivee: 'milo-chat', peu_consulte: 'luna-chat', relance_periodique: 'felix-chat' };
  const posts = rt.service.list();
  assert.equal(posts.length, 12);
  for (const p of posts) {
    assert.ok(p.text.includes(`/animaux/${attendu[p.trigger]}`), `${p.trigger}/${p.platform} : ${p.text}`);
  }
}));

test('6. SOCIAL_MODE=reel : simulation forcée, rien de publié réellement, aucune clé dans le journal', () => avecDossier(async (dir) => {
  const lignes = [];
  const logger = { log: (...a) => lignes.push(a.join(' ')), info: (...a) => lignes.push(a.join(' ')), warn: (...a) => lignes.push(a.join(' ')), error: (...a) => lignes.push(a.join(' ')) };
  const rt = creer(dir, { ...JEU, env: envBase({ SOCIAL_MODE: 'reel' }), logger });
  rt.scan();
  assert.ok(rt.service.connectorsStatus().every((s) => s.mode === 'simulation'), 'connecteurs en simulation');

  for (const p of rt.service.list()) rt.service.approve(p.id);
  const { processed } = await rt.service.runDue();
  assert.equal(processed.length, 12);
  assert.ok(processed.every((r) => r.ok && r.code === 'SIMULATED_OK'), JSON.stringify(processed));
  assert.ok(!processed.some((r) => r.code === 'NOT_IMPLEMENTED'));

  const journal = rt.service.getLog({ limit: 100 });
  assert.equal(journal.length, 12);
  assert.ok(journal.every((e) => e.mode === 'simulation' && e.result === 'ok'));
  assert.ok(journal.every((e) => /simulée/.test(e.message)), 'messages de publication simulée');

  const fichierJournal = readFileSync(path.join(dir, 'social', 'journal.jsonl'), 'utf8');
  assert.ok(!fichierJournal.includes(CLE), 'clé absente du journal');
  assert.ok(!readFileSync(path.join(dir, 'social', 'posts.json'), 'utf8').includes(CLE), 'clé absente des posts');
  assert.ok(!lignes.join('\n').includes(CLE), 'clé absente des logs applicatifs');
  assert.ok(lignes.some((l) => /simulation forcée/.test(l)), 'avertissement de simulation forcée');
}));

test('7. start() puis stop() : le processus enfant se termine (code 0, sans timeout)', () => avecDossier((dir) => {
  const code = `
    import { createSocialRuntime } from ${JSON.stringify(pathToFileURL(SOCIAL_JS).href)};
    const rt = createSocialRuntime({
      env: {}, dataDir: process.env.DATA_DIR_TEST, logger: { log() {}, info() {}, warn() {}, error() {} },
      now: () => ${NOW}, getAnimaux: () => [], getVues: () => ({}), getSeuil: () => 5,
    });
    rt.start();
    rt.stop();
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    env: { PATH: process.env.PATH, DATA_DIR_TEST: dir }, timeout: 15_000, encoding: 'utf8',
  });
  assert.notEqual(r.error?.code, 'ETIMEDOUT', 'processus bloqué : timeout dépassé');
  assert.equal(r.signal, null, r.stderr);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(path.join(dir, 'social')));
}));
