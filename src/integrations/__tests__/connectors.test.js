import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnectors } from '../connectors/index.js';

const PF = ['facebook', 'instagram', 'x', 'linkedin'];
const NOMS = { facebook: 'Facebook', instagram: 'Instagram', x: 'X', linkedin: 'LinkedIn' };
const CLE = 'SECRET-CLE-12345';
const envOk = (extra = {}) => {
  const e = { ...extra };
  for (const p of PF) {
    e[`SOCIAL_${p.toUpperCase()}_ENABLED`] = 'true';
    e[`SOCIAL_${p.toUpperCase()}_API_KEY`] = CLE;
  }
  return e;
};
const post = (platform, extra = {}) => ({
  id: 1, platform, text: 'Rex cherche une famille', imageUrl: 'https://exemple.test/rex.jpg', animalId: 'rex', ...extra,
});

test('interface : 4 plateformes et status()', () => {
  const c = createConnectors({ env: {} });
  assert.deepEqual(c.platforms, PF);
  const s = c.status();
  assert.equal(s.length, 4);
  for (const it of s) {
    assert.equal(it.enabled, false);
    assert.equal(it.mode, 'simulation');
    assert.equal(it.hasCredentials, false);
    assert.equal(typeof it.message, 'string');
  }
});

for (const p of PF) {
  const V = `SOCIAL_${p.toUpperCase()}`;
  test(`${p} : DISABLED par défaut`, async () => {
    const r = await createConnectors({ env: {} }).get(p).publish(post(p));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'DISABLED');
  });
  test(`${p} : MISSING_CREDENTIALS avec message explicite`, async () => {
    const r = await createConnectors({ env: { [`${V}_ENABLED`]: '1' } }).get(p).publish(post(p));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'MISSING_CREDENTIALS');
    assert.ok(r.message.includes(`${V}_API_KEY`));
    assert.ok(r.message.includes(NOMS[p]));
    assert.ok(r.message.includes('.env'));
  });
  test(`${p} : succès simulé`, async () => {
    const r = await createConnectors({ env: envOk() }).get(p).publish(post(p));
    assert.deepEqual([r.ok, r.code, r.simulated], [true, 'SIMULATED_OK', true]);
  });
  test(`${p} : SIMULATED_FAILURE (et seulement pour cette plateforme)`, async () => {
    const c = createConnectors({ env: envOk({ SOCIAL_SIMULATE_FAILURE: p }) });
    const r = await c.get(p).publish(post(p));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SIMULATED_FAILURE');
    const autre = PF.find((q) => q !== p);
    assert.equal((await c.get(autre).publish(post(autre))).ok, true);
  });
  test(`${p} : mode reel -> NOT_IMPLEMENTED`, async () => {
    const r = await createConnectors({ env: envOk({ SOCIAL_MODE: 'reel' }) }).get(p).publish(post(p));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'NOT_IMPLEMENTED');
    assert.match(r.message, /non implémentée/);
  });
  test(`${p} : publish ne lève jamais (entrées absurdes)`, async () => {
    const c = createConnectors({ env: envOk() }).get(p);
    const piege = { text: { toString() { throw new Error('boom'); } } };
    for (const entree of [undefined, null, 42, {}, piege]) {
      const r = await c.publish(entree);
      assert.equal(typeof r.ok, 'boolean');
      assert.equal(typeof r.code, 'string');
    }
  });
  test(`${p} : aucune clé dans les messages`, async () => {
    const cas = [envOk(), envOk({ SOCIAL_SIMULATE_FAILURE: p }), envOk({ SOCIAL_MODE: 'reel' }), { [`${V}_ENABLED`]: 'true' }];
    for (const env of cas) {
      const c = createConnectors({ env });
      const r = await c.get(p).publish(post(p));
      assert.ok(!JSON.stringify(r).includes(CLE));
      assert.ok(!JSON.stringify(c.status()).includes(CLE));
    }
  });
}

test('X : limite de 280 caractères Unicode avec ellipse', () => {
  const x = createConnectors({ env: envOk() }).get('x');
  const f = x.formatPost(post('x', { text: '🐶'.repeat(300) }));
  assert.equal([...f.text].length, 280);
  assert.ok(f.text.endsWith('…'));
  assert.equal(f.valid, true);
  const ok = x.formatPost(post('x', { text: 'a'.repeat(280) }));
  assert.equal(ok.text.length, 280);
  assert.ok(!ok.text.endsWith('…'));
});

test('Instagram : image obligatoire (IMAGE_REQUIRED)', async () => {
  const i = createConnectors({ env: envOk() }).get('instagram');
  const f = i.formatPost(post('instagram', { imageUrl: undefined }));
  assert.equal(f.valid, false);
  assert.ok(f.errors.length > 0);
  const r = await i.publish(post('instagram', { imageUrl: null }));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'IMAGE_REQUIRED');
  assert.equal(i.formatPost(post('instagram')).valid, true);
});

test('Facebook/LinkedIn : texte correct sans erreur, image facultative', () => {
  const c = createConnectors({ env: envOk() });
  for (const p of ['facebook', 'linkedin']) {
    const f = c.get(p).formatPost(post(p, { imageUrl: undefined }));
    assert.equal(f.valid, true);
    assert.equal(f.imageUrl, null);
  }
});

test('activation indépendante', () => {
  const s = createConnectors({ env: { SOCIAL_X_ENABLED: 'true', SOCIAL_X_API_KEY: 'k' } }).status();
  assert.deepEqual(s.filter((e) => e.enabled).map((e) => e.platform), ['x']);
  assert.equal(s.find((e) => e.platform === 'x').hasCredentials, true);
});
