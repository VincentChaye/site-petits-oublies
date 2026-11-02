import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csrfTokenFor, verifyCsrf, csrfProtection } from '../csrf.js';

const SECRET = 's'.repeat(40);
const SID = 'session-token';

function run(req) {
  const res = { statusCode: 200, body: '', setHeader() {}, end(b) { this.body = b; } };
  let next = false;
  csrfProtection({ secret: SECRET })({ sessionToken: SID, ...req }, res, () => { next = true; });
  return { res, next };
}

test('jeton : nominal, déterministe, lié à la session', () => {
  const t = csrfTokenFor(SID, SECRET);
  assert.match(t, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(verifyCsrf(SID, t, SECRET), true);
  assert.equal(verifyCsrf('autre', t, SECRET), false);
});

test('jeton falsifié ou invalide refusé', () => {
  const t = csrfTokenFor(SID, SECRET);
  assert.equal(verifyCsrf(SID, t.slice(0, -1) + (t.endsWith('A') ? 'B' : 'A'), SECRET), false);
  assert.equal(verifyCsrf(SID, 'court', SECRET), false);
  assert.equal(verifyCsrf(SID, undefined, SECRET), false);
  assert.equal(verifyCsrf(undefined, t, SECRET), false);
  assert.equal(verifyCsrf(SID, t, 'autre-secret'), false);
});

test('middleware : GET libre, POST sans jeton 403 en français', () => {
  assert.equal(run({ method: 'GET', headers: {} }).next, true);
  const r = run({ method: 'POST', headers: {}, body: {} });
  assert.equal(r.next, false);
  assert.equal(r.res.statusCode, 403);
  assert.match(r.res.body, /jeton CSRF/);
});

test('middleware : jeton dans body ou en-tête accepté, falsifié refusé', () => {
  const t = csrfTokenFor(SID, SECRET);
  assert.equal(run({ method: 'POST', headers: {}, body: { _csrf: t } }).next, true);
  assert.equal(run({ method: 'DELETE', headers: { 'x-csrf-token': t } }).next, true);
  assert.equal(run({ method: 'PUT', headers: { 'x-csrf-token': t + 'x' } }).res.statusCode, 403);
});

test('middleware : Origin vs Host', () => {
  const t = csrfTokenFor(SID, SECRET);
  const base = { method: 'POST', body: { _csrf: t } };
  assert.equal(run({ ...base, headers: { host: 'site.fr', origin: 'https://site.fr' } }).next, true);
  const r = run({ ...base, headers: { host: 'site.fr', origin: 'https://evil.example' } });
  assert.equal(r.res.statusCode, 403);
  assert.match(r.res.body, /origine/);
  assert.equal(run({ ...base, headers: { host: 'site.fr', origin: 'null' } }).res.statusCode, 403);
});

test('middleware : secret requis', () => {
  assert.throws(() => csrfProtection({}), /secret/);
});
