/**
 * Préparation des dossiers jetables du serveur de test. Appelée au chargement de
 * `playwright.config.js` (donc AVANT le démarrage du serveur, que Playwright lance
 * avant `globalSetup`) : `content/` est recopié et `data/` remis à zéro, si bien
 * qu'aucun test ne modifie le contenu ni les données du dépôt.
 * @module tests/e2e/preparer
 */
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { RACINE, DOSSIER_TMP, CONTENT_DIR, DATA_DIR } from './environnement.js';

export function preparerDossiersJetables() {
  rmSync(DOSSIER_TMP, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  cpSync(path.join(RACINE, 'content'), CONTENT_DIR, { recursive: true });
}
