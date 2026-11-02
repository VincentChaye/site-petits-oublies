import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeCsvField, toCsv } from '../csv.js';

test('préfixe apostrophe pour = + - @ tab CR', () => {
  for (const c of ['=', '+', '-', '@', '\t', '\r']) {
    assert.ok(escapeCsvField(`${c}x`).replace(/^"/, '').startsWith(`'${c}`), JSON.stringify(c));
  }
});
test('guillemets, virgules, sauts de ligne', () => {
  assert.equal(escapeCsvField('a"b'), '"a""b"');
  assert.equal(escapeCsvField('a,b'), '"a,b"');
  assert.equal(escapeCsvField('a\nb'), '"a\nb"');
  assert.equal(escapeCsvField('simple'), 'simple');
  assert.equal(escapeCsvField(null), '');
  assert.equal(escapeCsvField(42), '42');
});
test('toCsv', () => {
  assert.equal(toCsv(['a', 'b'], [{ a: '=1', b: 'x' }]), "a,b\r\n'=1,x\r\n");
});
