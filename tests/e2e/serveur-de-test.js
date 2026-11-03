/**
 * Lanceur du serveur de bout en bout : prépare les dossiers jetables puis démarre
 * le serveur normal. Exécuté une seule fois, par Playwright (`webServer.command`).
 *
 * La préparation ne peut pas vivre dans `playwright.config.js` (rechargé par chaque
 * worker, qui effacerait les dossiers en cours d'utilisation) ni dans `globalSetup`
 * (exécuté APRÈS le démarrage du serveur).
 * @module tests/e2e/serveur-de-test
 */
import { preparerDossiersJetables } from './preparer.js';

preparerDossiersJetables();
await import('../../src/server/index.js');
