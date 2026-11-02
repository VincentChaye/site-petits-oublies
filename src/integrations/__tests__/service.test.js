import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSocialService } from '../index.js';

const T0 = Date.parse('2026-11-01T10:00:00Z');
const FAKE_KEY = 'cle-factice-ultra-secrete-123';

function fakeConnectors({ platforms = ['facebook', 'instagram', 'x', 'linkedin'], behavior = {} } = {}) {
  const calls = [];
  const map = {};
  for (const p of ['facebook', 'instagram', 'x', 'linkedin']) {
    map[p] = {
      enabled: platforms.includes(p),
      formatPost: (post) => ({ text: post.text, imageUrl: post.imageUrl, valid: true, errors: [] }),
      async publish(post) {
        calls.push({ platform: p, id: post.id });
        const b = behavior[p];
        if (typeof b === 'function') return b(post);
        return { ok: true, code: 'SIMULATED_OK', message: 'Envoi simulé.', simulated: true };
      },
    };
  }
  return {
    calls, platforms: Object.keys(map), get: (p) => map[p],
    status: () => Object.keys(map).map((p) => ({ platform: p, enabled: map[p].enabled, mode: 'simulation', hasCredentials: false, message: '' })),
  };
}

function setup({ animals = [], connectors = fakeConnectors(), env = {} } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'social-'));
  const clock = { t: T0 };
  const svc = createSocialService({
    dataDir, env: { SOCIAL_RETRY_BASE_MS: '1000', SOCIAL_API_KEY_TEST: FAKE_KEY, ...env },
    getAnimals: () => animals, now: () => clock.t, connectors, contentDir: join(dataDir, 'absent'),
  });
  return { svc, clock, dataDir, connectors, cleanup: () => rmSync(dataDir, { recursive: true, force: true }) };
}
const luna = { id: 'luna', nom: 'Luna', espece: 'chat', arrivalDate: '2026-10-30' };
const rex = { id: 'rex', nom: 'Rex', espece: 'chien', arrivalDate: '2026-01-10' };
const readJournal = (dir) => readFileSync(join(dir, 'social/journal.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('cycle complet : generate → approve → runDue → envoye → journal', async () => {
  const { svc, dataDir, connectors, cleanup } = setup();
  const r = svc.generate('arrivee', luna);
  assert.equal(r.created.length, 4);
  assert.ok(r.created.every((p) => p.status === 'en_validation' && p.text.includes('Luna')));
  assert.equal((await svc.runDue()).processed.length, 0, 'rien à envoyer avant validation');
  for (const p of r.created) svc.approve(p.id);
  assert.ok(svc.list({ status: 'planifie' }).length === 4);
  await svc.runDue();
  assert.equal(svc.list({ status: 'envoye' }).length, 4);
  assert.equal(connectors.calls.length, 4);
  const j = readJournal(dataDir);
  assert.equal(j.length, 4);
  assert.deepEqual(Object.keys(j[0]).sort(), ['code', 'message', 'mode', 'platform', 'postId', 'result', 'ts']);
  assert.equal(j[0].result, 'ok');
  assert.equal(svc.getLog({ limit: 2 }).length, 2);
  cleanup();
});

test('planification future : pas d’envoi avant scheduledAt', async () => {
  const { svc, clock, cleanup } = setup({ connectors: fakeConnectors({ platforms: ['x'] }) });
  const [p] = svc.generate('arrivee', luna).created;
  svc.approve(p.id, { scheduledAt: new Date(T0 + 60_000).toISOString() });
  await svc.runDue();
  assert.equal(svc.get(p.id).status, 'planifie');
  clock.t += 60_000;
  await svc.runDue();
  assert.equal(svc.get(p.id).status, 'envoye');
  cleanup();
});

test('seules les plateformes activées génèrent des posts', () => {
  const { svc, cleanup } = setup({ connectors: fakeConnectors({ platforms: ['facebook', 'x'] }) });
  const r = svc.generate('peu_consulte', rex);
  assert.deepEqual(r.created.map((p) => p.platform).sort(), ['facebook', 'x']);
  cleanup();
});

test('édition avec historique conservé, puis rejet', () => {
  const { svc, cleanup } = setup({ connectors: fakeConnectors({ platforms: ['facebook'] }) });
  const [p] = svc.generate('arrivee', luna).created;
  const original = p.text;
  const e = svc.edit(p.id, { text: 'Texte corrigé par un humain' });
  assert.equal(e.status, 'en_validation');
  assert.equal(e.text, 'Texte corrigé par un humain');
  assert.ok(e.history.some((h) => h.action === 'cree' && h.text === original));
  assert.ok(e.history.some((h) => h.action === 'modifie'));
  assert.throws(() => svc.edit(p.id, { text: '  ' }), { code: 'TEXTE_INVALIDE' });
  const r = svc.reject(p.id, { reason: 'Photo à changer' });
  assert.equal(r.status, 'rejete');
  assert.equal(r.rejectReason, 'Photo à changer');
  assert.throws(() => svc.approve(p.id), { code: 'STATUT_INVALIDE' });
  assert.throws(() => svc.get('inconnu'), { code: 'INTROUVABLE' });
  cleanup();
});

test('dédoublonnage et période de relance', () => {
  const { svc, clock, cleanup } = setup({ connectors: fakeConnectors({ platforms: ['facebook'] }) });
  const first = svc.generate('peu_consulte', rex);
  assert.equal(first.created.length, 1);
  const second = svc.generate('peu_consulte', rex);
  assert.equal(second.created.length, 0);
  assert.equal(second.skipped[0].reason, 'deja_en_file');
  // rejet puis nouvelle tentative dans la période : toujours refusé
  svc.reject(first.created[0].id, { reason: 'test' });
  assert.equal(svc.generate('peu_consulte', rex).skipped[0].reason, 'periode_relance');
  // relance périodique : une par période de 30 jours
  const a = svc.generate('relance_periodique', rex);
  assert.equal(a.created.length, 1);
  svc.reject(a.created[0].id, {});
  clock.t += 29 * 86_400_000;
  assert.equal(svc.generate('relance_periodique', rex).created.length, 0);
  clock.t += 2 * 86_400_000;
  assert.equal(svc.generate('relance_periodique', rex).created.length, 1);
  cleanup();
});

test('scanTriggers : au moins 3 déclencheurs (arrivée, peu consulté, relance périodique)', () => {
  const vieux = { id: 'milo', nom: 'Milo', espece: 'chat', arrivalDate: '2025-05-01' };
  const { svc, cleanup } = setup({ animals: [luna, rex, vieux], connectors: fakeConnectors({ platforms: ['facebook'] }) });
  const r = svc.scanTriggers({ belowThreshold: [rex] });
  const triggers = new Set(r.created.map((p) => p.trigger));
  assert.deepEqual([...triggers].sort(), ['arrivee', 'peu_consulte', 'relance_periodique']);
  assert.equal(r.created.find((p) => p.trigger === 'arrivee').animalId, 'luna');
  assert.equal(r.created.find((p) => p.trigger === 'relance_periodique').animalId, 'milo');
  // second passage : rien de nouveau pour luna/rex ; milo déjà relancé
  const again = svc.scanTriggers({ belowThreshold: [rex] });
  assert.equal(again.created.length, 0);
  cleanup();
});

test('3 reprises à délais doublés, échec définitif, puis retry manuel', async () => {
  let fail = true;
  const connectors = fakeConnectors({
    platforms: ['facebook'],
    behavior: { facebook: () => (fail ? { ok: false, code: 'NETWORK_ERROR', message: 'Réseau indisponible (simulé).', simulated: true } : { ok: true, code: 'SIMULATED_OK', message: 'ok', simulated: true }) },
  });
  const { svc, clock, dataDir, cleanup } = setup({ connectors });
  const [p] = svc.generate('arrivee', luna).created;
  svc.approve(p.id);
  const base = 1000;
  await svc.runDue();                                   // tentative 1
  assert.equal(svc.get(p.id).attempts, 1);
  assert.equal(svc.get(p.id).nextAttemptAt, new Date(T0 + base).toISOString());
  await svc.runDue();                                   // trop tôt : rien
  assert.equal(svc.get(p.id).attempts, 1);
  clock.t += base; await svc.runDue();                  // tentative 2, délai 2×
  assert.equal(svc.get(p.id).nextAttemptAt, new Date(clock.t + 2 * base).toISOString());
  clock.t += 2 * base; await svc.runDue();             // tentative 3, délai 4×
  assert.equal(svc.get(p.id).nextAttemptAt, new Date(clock.t + 4 * base).toISOString());
  assert.equal(svc.get(p.id).status, 'planifie');
  clock.t += 4 * base; await svc.runDue();             // tentative 4 → échec définitif
  const done = svc.get(p.id);
  assert.equal(done.status, 'echec');
  assert.equal(done.attempts, 4);
  assert.equal(connectors.calls.length, 4);
  clock.t += 10 * base; await svc.runDue();
  assert.equal(connectors.calls.length, 4, 'plus aucune tentative automatique');
  assert.equal(readJournal(dataDir).filter((j) => j.result === 'echec').length, 4);
  fail = false;
  assert.equal(svc.retry(p.id).status, 'planifie');
  await svc.runDue();
  assert.equal(svc.get(p.id).status, 'envoye');
  assert.throws(() => svc.retry(p.id), { code: 'STATUT_INVALIDE' });
  cleanup();
});

test('MISSING_CREDENTIALS remonté sans casser les autres plateformes', async () => {
  const connectors = fakeConnectors({
    platforms: ['facebook', 'x'],
    behavior: { facebook: () => ({ ok: false, code: 'MISSING_CREDENTIALS', message: 'Clé API Facebook manquante : publication impossible.', simulated: false }) },
  });
  const { svc, dataDir, cleanup } = setup({ connectors });
  const { created } = svc.generate('arrivee', luna);
  created.forEach((p) => svc.approve(p.id));
  await svc.runDue();
  const byPlatform = Object.fromEntries(svc.list().map((p) => [p.platform, p]));
  assert.equal(byPlatform.x.status, 'envoye');
  assert.equal(byPlatform.facebook.status, 'planifie');
  assert.equal(byPlatform.facebook.lastError.code, 'MISSING_CREDENTIALS');
  const j = readJournal(dataDir).find((e) => e.platform === 'facebook');
  assert.equal(j.code, 'MISSING_CREDENTIALS');
  assert.equal(j.result, 'echec');
  cleanup();
});

test('un connecteur qui lève une exception ne casse ni runDue ni les autres', async () => {
  const connectors = fakeConnectors({ platforms: ['facebook', 'x'], behavior: { facebook: () => { throw new Error('boum'); } } });
  const { svc, cleanup } = setup({ connectors });
  svc.generate('arrivee', luna).created.forEach((p) => svc.approve(p.id));
  await svc.runDue();
  assert.equal(svc.list({ status: 'envoye' }).length, 1);
  assert.equal(svc.list({ status: 'planifie' })[0].lastError.code, 'ERREUR_INTERNE');
  cleanup();
});

test('aucun secret dans journal.jsonl ni posts.json', async () => {
  const connectors = fakeConnectors({
    platforms: ['facebook'],
    behavior: { facebook: () => ({ ok: false, code: 'API_ERROR', message: `Refus avec la clé ${FAKE_KEY}`, simulated: false }) },
  });
  const { svc, dataDir, cleanup } = setup({ connectors });
  const [p] = svc.generate('arrivee', luna).created;
  svc.approve(p.id);
  await svc.runDue();
  const journal = readFileSync(join(dataDir, 'social/journal.jsonl'), 'utf8');
  const posts = readFileSync(join(dataDir, 'social/posts.json'), 'utf8');
  assert.ok(!journal.includes(FAKE_KEY) && !posts.includes(FAKE_KEY));
  assert.ok(journal.includes('***'));
  cleanup();
});

test('intégration avec les vrais connecteurs (dev-api) : simulation, clé absente, échec forcé', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'social-real-'));
  const env = {
    SOCIAL_X_ENABLED: 'true', SOCIAL_X_API_KEY: FAKE_KEY,
    SOCIAL_FACEBOOK_ENABLED: 'true', // sans clé
    SOCIAL_LINKEDIN_ENABLED: 'true', SOCIAL_LINKEDIN_API_KEY: FAKE_KEY, SOCIAL_SIMULATE_FAILURE: 'linkedin',
    SOCIAL_RETRY_BASE_MS: '1000',
  };
  const svc = createSocialService({ dataDir, env, getAnimals: () => [], now: () => T0 });
  const { created } = svc.generate('arrivee', luna);
  assert.deepEqual(created.map((p) => p.platform).sort(), ['facebook', 'linkedin', 'x']);
  created.forEach((p) => svc.approve(p.id));
  await svc.runDue();
  const by = Object.fromEntries(svc.list().map((p) => [p.platform, p]));
  assert.equal(by.x.status, 'envoye');
  assert.equal(by.facebook.lastError.code, 'MISSING_CREDENTIALS');
  assert.equal(by.linkedin.lastError.code, 'SIMULATED_FAILURE');
  const j = readFileSync(join(dataDir, 'social/journal.jsonl'), 'utf8');
  assert.ok(j.includes('SIMULATED_OK') && !j.includes(FAKE_KEY));
  rmSync(dataDir, { recursive: true, force: true });
});

test('persistance : rechargement des posts et planificateur sans exception', async () => {
  const { svc, dataDir, connectors, cleanup } = setup({ connectors: fakeConnectors({ platforms: ['x'] }) });
  const [p] = svc.generate('arrivee', luna).created;
  const svc2 = createSocialService({ dataDir, env: {}, getAnimals: () => [], now: () => T0, connectors });
  assert.equal(svc2.get(p.id).text, p.text);
  svc2.approve(p.id);
  assert.equal(svc2.startScheduler(20), true);
  await new Promise((r) => setTimeout(r, 120));
  svc2.stopScheduler();
  assert.equal(svc2.get(p.id).status, 'envoye');
  cleanup();
});
