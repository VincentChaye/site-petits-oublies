/**
 * Environnement partagé des tests de bout en bout.
 * Le serveur de test tourne sur un dossier de contenu et un dossier de données
 * jetables (`.tmp-e2e/`) : aucun test ne modifie `content/` ni `data/` du dépôt.
 * @module tests/e2e/environnement
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DOSSIER_TMP = path.join(RACINE, '.tmp-e2e');
export const CONTENT_DIR = path.join(DOSSIER_TMP, 'content');
export const DATA_DIR = path.join(DOSSIER_TMP, 'data');

export const PORT = Number(process.env.E2E_PORT || 3100);
export const BASE_URL = `http://127.0.0.1:${PORT}`;
/** Secret de test (≥ 32 caractères, jamais la valeur d'exemple). Local et jetable. */
export const INTERNAL_SECRET = 'secret-de-test-e2e-0123456789abcdef-xyz';
/** Seuil d'alerte du tableau de bord pendant les tests. */
export const ATTENTION_THRESHOLD = 5;
