/**
 * Export CSV sûr contre l'injection de formules (tableurs).
 * @module security/csv
 */

const DECLENCHEURS = /^\s*[=+\-@\t\r]/;

/**
 * Échappe un champ CSV : préfixe `'` si la valeur commence par = + - @ tab ou CR,
 * double les guillemets et entoure de guillemets si nécessaire.
 * @param {unknown} value Valeur (null/undefined → chaîne vide).
 * @returns {string} Champ CSV sûr.
 */
export function escapeCsvField(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (DECLENCHEURS.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Construit un document CSV (lignes séparées par CRLF).
 * @param {string[]} columns Colonnes (clés et en-têtes).
 * @param {Array<Record<string, unknown>>} rows Lignes.
 * @returns {string} Contenu CSV.
 */
export function toCsv(columns, rows) {
  const lignes = [columns.map(escapeCsvField).join(',')];
  for (const r of rows) lignes.push(columns.map((c) => escapeCsvField(r?.[c])).join(','));
  return lignes.join('\r\n') + '\r\n';
}
