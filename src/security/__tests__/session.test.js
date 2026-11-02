import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  verifySecret, createSessionStore, sessionCookieHeader, clearSessionCookieHeader,
  attachSessionCookie, requireSession, readSessionToken,
} from '../session.js';

function fakeRes() {
  return { headers: {}, statusCode: 200, body: '', setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
}

test('verifySecret nominal et échecs sans lever', () => {
  assert.equal(verifySecret('abc', 'abc'), true);
  assert.equal(verifySecret('abc', 'abd'), false);
  assert.equal(verifySecret('a', 'abcdef'), false);
  assert.equal(verifySecret(undefined, 'abc'), false);
  assert.equal(verifySecret(123, 'abc'), false);
  assert.equal(verifySecret('', ''), false);
});

test('store : create/validate/destroy', () => {
  const s = createSessionStore({ ttlMs: 1000 });
  const t = s.create();
  assert.match(t, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(t, s.create());
  assert.equal(s.validate(t), true);
  assert.equal(s.validate('inconnu'), false);
  assert.equal(s.validate(undefined), false);
  s.destroy(t);
  assert.equal(s.validate(t), false);
});

test('store : session expirée', () => {
  let now = 1000;
  const s = createSessionStore({ ttlMs: 500, now: () => now });
  const t = s.create();
  now = 1499;
  assert.equal(s.validate(t), true);
  now = 1500;
  assert.equal(s.validate(t), false);
  assert.throws(() => createSessionStore({ ttlMs: 0 }));
});

test('cookie : drapeaux avec/sans production', () => {
  const dev = sessionCookieHeader('tok', { isProduction: false, maxAgeSec: 60 });
  assert.match(dev, /HttpOnly/);
  assert.match(dev, /SameSite=Strict/);
  assert.match(dev, /Path=\/interne(;|$)/);
  assert.match(dev, /Max-Age=60/);
  assert.doesNotMatch(dev, /Secure/);
  assert.match(sessionCookieHeader('tok', { isProduction: true }), /; Secure/);
  const clr = clearSessionCookieHeader({ isProduction: true });
  assert.match(clr, /Max-Age=0/);
  assert.match(clr, /Secure/);
});

test('attachSessionCookie : refus hors /interne', () => {
  const res = fakeRes();
  assert.throws(() => attachSessionCookie({ path: '/' }, res, 't'), /\/interne/);
  assert.throws(() => attachSessionCookie({ path: '/internet' }, res, 't'), /\/interne/);
  assert.throws(() => attachSessionCookie({ path: '/adoption' }, res, 't'), /\/interne/);
  assert.equal(res.headers['Set-Cookie'], undefined);
  attachSessionCookie({ path: '/interne/login' }, res, 't', { isProduction: true });
  assert.match(res.headers['Set-Cookie'], /^sid=t; HttpOnly/);
});

test('requireSession', () => {
  const s = createSessionStore({ ttlMs: 1000 });
  const t = s.create();
  assert.equal(readSessionToken('a=1; sid=' + t + '; b=2'), t);
  const mw = requireSession(s);

  const req = { headers: { cookie: `x=1; sid=${t}` } };
  let appele = false;
  mw(req, fakeRes(), () => { appele = true; });
  assert.ok(appele);
  assert.equal(req.sessionToken, t);

  for (const cookie of [undefined, 'sid=faux', 'autre=1']) {
    const res = fakeRes();
    let n = false;
    mw({ headers: { cookie } }, res, () => { n = true; });
    assert.equal(n, false);
    assert.equal(res.statusCode, 401);
  }
});
