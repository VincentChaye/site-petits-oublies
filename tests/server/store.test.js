import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStore, CorruptedStoreError } from '../../src/server/store.js';

async function withDir(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'store-'));
  try { await fn(dir, createStore({ dir })); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('lecture : valeur par défaut si absent', () => withDir(async (_d, s) => {
  assert.deepEqual(await s.read('x', []), []);
}));

test('écriture atomique : fichier final valide, aucun temporaire résiduel', () => withDir(async (dir, s) => {
  await s.write('animaux', [{ id: 1 }]);
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'animaux.json'), 'utf8')), [{ id: 1 }]);
  assert.deepEqual(await readdir(dir), ['animaux.json']);
}));

test('écritures concurrentes sérialisées : aucune mise à jour perdue', () => withDir(async (dir, s) => {
  await s.write('c', { n: 0 });
  await Promise.all(Array.from({ length: 50 }, () => s.update('c', (v) => ({ n: v.n + 1 }))));
  assert.equal((await s.read('c')).n, 50);
  assert.deepEqual(await readdir(dir), ['c.json']);
}));

test('JSON corrompu : erreur explicite, fichier non écrasé', () => withDir(async (dir, s) => {
  const f = path.join(dir, 'bad.json');
  await writeFile(f, '{ pas du json');
  await assert.rejects(s.read('bad', []), CorruptedStoreError);
  await assert.rejects(s.update('bad', () => ({ a: 1 }), []), CorruptedStoreError);
  assert.equal(await readFile(f, 'utf8'), '{ pas du json');
}));

test('nom de collection invalide refusé', () => withDir(async (_d, s) => {
  assert.throws(() => s.read('../etc/passwd'), /invalide/);
}));
