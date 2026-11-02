import test from 'node:test';
import assert from 'node:assert/strict';
import { purgeOldSubmissions } from '../purge.js';

const now = new Date('2026-11-02T00:00:00Z');
test('purge au-delà de 12 mois, sans muter', () => {
  const data = [
    { id: 1, createdAt: '2025-11-01T00:00:00Z' },
    { id: 2, createdAt: '2025-11-02T00:00:00Z' },
    { id: 3, createdAt: '2026-10-01T00:00:00Z' },
    { id: 4 },
    { id: 5, createdAt: 'illisible' },
  ];
  const copie = structuredClone(data);
  const { kept, purged } = purgeOldSubmissions(data, { now });
  assert.deepEqual(kept.map((s) => s.id), [2, 3]);
  assert.deepEqual(purged.map((s) => s.id), [1, 4, 5]);
  assert.deepEqual(data, copie);
});
test('entrées invalides', () => {
  assert.throws(() => purgeOldSubmissions('x'), /tableau/);
  assert.throws(() => purgeOldSubmissions([], { months: 0 }), /mois/);
});
