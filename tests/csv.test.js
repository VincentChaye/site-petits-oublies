import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeCsvField, toCsv } from '../src/security/csv.js';

test('neutralise = + - @ tab CR', () => {
  assert.equal(escapeCsvField('=1+1'), "'=1+1");
  assert.equal(escapeCsvField('+1'), "'+1");
  assert.equal(escapeCsvField('-1'), "'-1");
  assert.equal(escapeCsvField('@x'), "'@x");
  assert.equal(escapeCsvField('\tx'), "'\tx");
  assert.equal(escapeCsvField('\rx'), '"\'\rx"');
});
test('espaces/blancs initiaux avant le déclencheur', () => {
  assert.equal(escapeCsvField('  =1'), "'  =1");
  assert.equal(escapeCsvField(' \t@a'), "' \t@a");
  assert.equal(escapeCsvField(' =1'), "' =1");
});
test('texte normal inchangé', () => {
  assert.equal(escapeCsvField('Bonjour'), 'Bonjour');
  assert.equal(escapeCsvField('  salut a=b'), '  salut a=b');
});
test('guillemets et virgules après neutralisation', () => {
  assert.equal(escapeCsvField(' =a,"b"'), `"' =a,""b"""`);
  assert.equal(escapeCsvField('a"b'), '"a""b"');
  assert.equal(escapeCsvField('a,b'), '"a,b"');
});
test('valeurs non-string', () => {
  assert.equal(escapeCsvField(null), '');
  assert.equal(escapeCsvField(undefined), '');
  assert.equal(escapeCsvField(5), '5');
  assert.equal(escapeCsvField(-5), "'-5");
  assert.equal(toCsv(['a'], [{ a: ' =1' }, null]), "a\r\n' =1\r\n\r\n");
});
