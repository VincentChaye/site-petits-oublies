import test from 'node:test';
import assert from 'node:assert/strict';
import { securityHeaders, securityHeadersMiddleware, CONTENT_SECURITY_POLICY } from '../headers.js';

test('CSP sans inline et directives requises', () => {
  assert.doesNotMatch(CONTENT_SECURITY_POLICY, /unsafe-inline|unsafe-eval/);
  for (const d of ["script-src 'self'", "style-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'"]) {
    assert.ok(CONTENT_SECURITY_POLICY.split('; ').includes(d), d);
  }
});
test('autres en-têtes et HSTS en production seulement', () => {
  const h = securityHeaders();
  assert.equal(h['X-Content-Type-Options'], 'nosniff');
  assert.equal(h['Referrer-Policy'], 'no-referrer');
  assert.equal(h['X-Frame-Options'], 'DENY');
  assert.ok(h['Permissions-Policy']);
  assert.equal('Strict-Transport-Security' in h, false);
  assert.ok(securityHeaders({ isProduction: true })['Strict-Transport-Security']);
});
test('middleware pose les en-têtes sans Set-Cookie', () => {
  const poses = {};
  let suite = false;
  securityHeadersMiddleware()({}, { setHeader: (k, v) => { poses[k] = v; } }, () => { suite = true; });
  assert.ok(suite && poses['Content-Security-Policy']);
  assert.equal('Set-Cookie' in poses, false);
});
