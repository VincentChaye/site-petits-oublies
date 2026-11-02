import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const INDEX = resolve(import.meta.dirname, '../../src/server/index.js');
const SECRET_VALIDE = 'secret-de-test-0123456789abcdef-0123456789abcdef';
const SECRET_EXEMPLE = 'CHANGEZ-MOI-0123456789abcdef0123456789abcdef';

function portLibre() {
  return new Promise((ok, ko) => {
    const s = createServer();
    s.once('error', ko);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

/**
 * Lance index.js dans un dossier vide (donc sans .env) avec l'environnement donné.
 * `quand(sortie)` peut renvoyer true pour demander l'arrêt (SIGTERM) du serveur.
 */
async function lancer(secret, quand = () => false) {
  const cwd = mkdtempSync(join(tmpdir(), 'startup-'));
  const port = await portLibre();
  const env = { ...process.env, PORT: String(port) };
  delete env.INTERNAL_SECRET;
  if (secret !== undefined) env.INTERNAL_SECRET = secret;
  const enfant = spawn(process.execPath, [INDEX], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let sortie = '';
  let arret = false;
  const lire = (d) => {
    sortie += d;
    if (!arret && quand(sortie)) { arret = true; enfant.kill('SIGTERM'); }
  };
  enfant.stdout.on('data', lire);
  enfant.stderr.on('data', lire);
  const minuterie = setTimeout(() => enfant.kill('SIGKILL'), 15000);
  const { code, signal } = await new Promise((ok) => enfant.on('close', (code, signal) => ok({ code, signal })));
  clearTimeout(minuterie);
  rmSync(cwd, { recursive: true, force: true });
  return { code, signal, sortie, arret };
}

function refus(r, secret) {
  assert.equal(r.code, 1, `code de sortie attendu 1, reçu ${r.code} (${r.signal})`);
  assert.match(r.sortie, /Configuration invalide/);
  assert.match(r.sortie, /cp \.env\.example \.env/);
  assert.match(r.sortie, /INTERNAL_SECRET/);
  assert.doesNotMatch(r.sortie, /Serveur démarré/);
  if (secret) assert.ok(!r.sortie.includes(secret), 'le secret ne doit pas apparaître dans la sortie');
}

test('démarrage refusé si INTERNAL_SECRET est absent', async () => {
  refus(await lancer(undefined));
});

test('démarrage refusé si INTERNAL_SECRET est vide', async () => {
  refus(await lancer(''));
});

test("démarrage refusé si INTERNAL_SECRET est la valeur d'exemple", async () => {
  refus(await lancer(SECRET_EXEMPLE), SECRET_EXEMPLE);
});

test('démarrage accepté avec un secret valide, puis arrêt propre', async () => {
  const r = await lancer(SECRET_VALIDE, (s) => s.includes('Serveur démarré'));
  assert.ok(r.arret, 'le serveur aurait dû annoncer son démarrage');
  assert.match(r.sortie, /Serveur démarré/);
  assert.ok(r.code === 0 || r.signal === 'SIGTERM', `arrêt inattendu : code ${r.code}, signal ${r.signal}`);
  assert.ok(!r.sortie.includes(SECRET_VALIDE), 'le secret ne doit pas apparaître dans la sortie');
});
