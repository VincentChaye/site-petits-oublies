import test from 'node:test';
import assert from 'node:assert/strict';
import { validateForm, sanitizeText } from '../validation.js';

test('contact valide', () => {
  const r = validateForm('contact', { nom: ' Léa ', email: 'lea@example.org', sujet: 'Bonjour', message: 'Un message assez long.', consentement: 'on', extra: 'x' });
  assert.equal(r.valid, true);
  assert.equal(r.values.nom, 'Léa');
  assert.equal('extra' in r.values, false);
});
test('champs obligatoires et e-mail invalide en français', () => {
  const r = validateForm('contact', { email: 'pas-un-mail' });
  assert.equal(r.valid, false);
  assert.match(r.errors.nom, /obligatoire/);
  assert.match(r.errors.email, /pas valide/);
  assert.match(r.errors.consentement, /consentement/);
});
test('longueurs maximales', () => {
  const r = validateForm('interet', { prenom: 'a'.repeat(101), email: 'a@b.fr', consentement: 'on' });
  assert.match(r.errors.prenom, /100 caractères/);
});
test('benevolat et don_parrainage', () => {
  assert.equal(validateForm('benevolat', { nom: 'Jo Li', email: 'jo@x.fr', disponibilites: 'Samedi matin', envies: 'Promenades', consentement: true }).valid, true);
  assert.equal(validateForm('don_parrainage', { nom: 'Jo Li', email: 'jo@x.fr', type: 'don_materiel', message: 'Des croquettes.', consentement: 'on' }).valid, true);
  assert.equal(validateForm('don_parrainage', { nom: 'Jo Li', email: 'jo@x.fr', type: 'parrainage', animal: 'biscotte', message: 'Je parraine.', consentement: 'on' }).valid, true);
  assert.ok(validateForm('don_parrainage', { nom: 'Jo Li', email: 'jo@x.fr', type: 'autre', message: 'Bonjour.', consentement: 'on' }).errors.type);
  assert.ok(validateForm('don_parrainage', { nom: 'Jo Li', email: 'jo@x.fr', type: 'parrainage', animal: 'Chat Perché', message: 'Bonjour.', consentement: 'on' }).errors.animal);
});
test('assainissement et entrées hostiles', () => {
  assert.equal(sanitizeText('a\u0000b\u0007c'), 'a b c');
  assert.equal(sanitizeText({}), '');
  assert.throws(() => validateForm('__proto__', {}), /inconnu/);
  assert.equal(validateForm('contact', null).valid, false);
});
