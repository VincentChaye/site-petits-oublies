import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSecurityConfig } from '../config.js';

const BON = 'x'.repeat(40);

test('config valide, figée, isProduction', () => {
  const c = loadSecurityConfig({ INTERNAL_SECRET: BON, NODE_ENV: 'production' });
  assert.equal(c.internalSecret, BON);
  assert.equal(c.isProduction, true);
  assert.ok(Object.isFrozen(c));
  assert.equal(loadSecurityConfig({ INTERNAL_SECRET: BON }).isProduction, false);
});

test('secret absent ou vide refusé', () => {
  assert.throws(() => loadSecurityConfig({}), /absent/);
  assert.throws(() => loadSecurityConfig({ INTERNAL_SECRET: '' }), /absent/);
});

test('secret court refusé sans fuite', () => {
  const court = 'abc123court';
  assert.throws(() => loadSecurityConfig({ INTERNAL_SECRET: court }), (e) => {
    assert.match(e.message, /trop court/);
    assert.ok(!e.message.includes(court));
    return true;
  });
});

test("valeur d'exemple refusée (casse indifférente, préfixe)", () => {
  for (const v of ['CHANGEZ-MOI', 'changez-moi', 'Changez-Moi-' + 'a'.repeat(40)]) {
    assert.throws(() => loadSecurityConfig({ INTERNAL_SECRET: v }), (e) => {
      assert.match(e.message, /exemple/);
      assert.ok(!e.message.includes(v));
      return true;
    });
  }
});
