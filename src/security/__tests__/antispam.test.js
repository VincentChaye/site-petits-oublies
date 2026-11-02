import test from 'node:test';
import assert from 'node:assert/strict';
import { honeypotPassed, issueFormToken, verifyFormToken, createRateLimiter } from '../antispam.js';

const S = 'x'.repeat(40);
test('honeypot', () => {
  assert.equal(honeypotPassed({}), true);
  assert.equal(honeypotPassed({ website: '  ' }), true);
  assert.equal(honeypotPassed({ website: 'http://spam' }), false);
});
test('jeton : délais min et max, signature', () => {
  const t = issueFormToken(S, 1000);
  assert.equal(verifyFormToken(t, S, { now: 1500 }).ok, false);
  assert.equal(verifyFormToken(t, S, { now: 5000 }).ok, true);
  assert.equal(verifyFormToken(t, S, { now: 1000 + 3 * 3600e3 }).ok, false);
  assert.equal(verifyFormToken(t, 'y'.repeat(40), { now: 5000 }).ok, false);
  assert.equal(verifyFormToken(t.replace(/^\d+/, '1'), S, { now: 5000 }).ok, false);
  assert.equal(verifyFormToken(undefined, S).ok, false);
  assert.match(verifyFormToken('a.b', S).message, /invalide/);
});
test('limitation de débit : aucune écriture disque, aucune IP en clair', async () => {
  const { readFileSync, mkdtempSync, readdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const src = readFileSync(new URL('../antispam.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /node:fs|from ['"]fs['"]|require\(['"]fs/);
  const dir = mkdtempSync(join(tmpdir(), 'antispam-'));
  const cwd = process.cwd();
  try {
    process.chdir(dir);
    const rl = createRateLimiter({ max: 2, windowMs: 1000, now: () => 0 });
    for (let i = 0; i < 5; i++) rl.check('203.0.113.7');
    rl.sweep();
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }
});
test('limitation de débit par IP', () => {
  let n = 0;
  const rl = createRateLimiter({ max: 2, windowMs: 1000, now: () => n });
  assert.equal(rl.check('1.1.1.1').allowed, true);
  assert.equal(rl.check('1.1.1.1').allowed, true);
  const r = rl.check('1.1.1.1');
  assert.equal(r.allowed, false);
  assert.ok(r.retryAfterSec >= 1);
  assert.equal(rl.check('2.2.2.2').allowed, true);
  n = 2000;
  assert.equal(rl.check('1.1.1.1').allowed, true);
  rl.sweep();
  assert.throws(() => createRateLimiter({ max: 0 }), /invalides/);
});
