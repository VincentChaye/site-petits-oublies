import test from 'node:test';
import assert from 'node:assert/strict';
import { verifierMemeOrigine } from '../origine.js';

const req = (headers) => ({ headers });

test('Sec-Fetch-Site prime : same-origin et none passent', () => {
  for (const site of ['same-origin', 'none']) {
    const v = verifierMemeOrigine(req({ 'sec-fetch-site': site, host: 'exemple.test', origin: 'null' }));
    assert.equal(v.ok, true, site);
    assert.equal(v.source, 'sec-fetch-site');
  }
});

test('cas réel Chromium : Origin « null » + Sec-Fetch-Site same-origin est accepté', () => {
  // Referrer-Policy: no-referrer ⇒ Chromium envoie Origin: null sur un POST de formulaire.
  assert.equal(verifierMemeOrigine(req({ origin: 'null', 'sec-fetch-site': 'same-origin', host: '127.0.0.1:3000' })).ok, true);
});

test('Sec-Fetch-Site cross-site ou same-site est refusé, même sans Origin', () => {
  for (const site of ['cross-site', 'same-site']) {
    const v = verifierMemeOrigine(req({ 'sec-fetch-site': site, host: 'exemple.test' }));
    assert.equal(v.ok, false, site);
    assert.match(v.motif, /Sec-Fetch-Site/);
  }
});

test('sans Sec-Fetch-Site : Origin doit correspondre à Host', () => {
  assert.equal(verifierMemeOrigine(req({ origin: 'http://exemple.test', host: 'exemple.test' })).ok, true);
  assert.equal(verifierMemeOrigine(req({ origin: 'https://attaquant.test', host: 'exemple.test' })).ok, false);
  assert.equal(verifierMemeOrigine(req({ origin: 'pas-une-url', host: 'exemple.test' })).ok, false);
});

test('sans Sec-Fetch-Site : un Origin opaque est refusé', () => {
  const v = verifierMemeOrigine(req({ origin: 'null', host: 'exemple.test' }));
  assert.equal(v.ok, false);
  assert.match(v.motif, /opaque/);
});

test('ni Origin ni Sec-Fetch-Site (client non navigateur) : accepté, le CSRF reste la garde', () => {
  const v = verifierMemeOrigine(req({ host: 'exemple.test' }));
  assert.equal(v.ok, true);
  assert.equal(v.source, 'absence');
});

test('en-têtes répétés : seule la première valeur est lue, et aucune exception', () => {
  assert.equal(verifierMemeOrigine(req({ 'sec-fetch-site': ['same-origin', 'cross-site'] })).ok, true);
  assert.equal(verifierMemeOrigine(req({ 'sec-fetch-site': ['cross-site'] })).ok, false);
  assert.equal(verifierMemeOrigine({}).ok, true);
  assert.equal(verifierMemeOrigine(undefined).ok, true);
});

test('aucun secret ni donnée personnelle dans le motif', () => {
  const v = verifierMemeOrigine(req({ origin: 'https://attaquant.test', host: 'exemple.test', cookie: 'sid=secret' }));
  assert.equal(v.ok, false);
  assert.doesNotMatch(v.motif, /secret|attaquant/);
});
