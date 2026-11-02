/**
 * Purge des soumissions dépassant la durée de conservation (12 mois).
 * API pure : ne modifie pas l'entrée, n'écrit rien, l'horloge est injectable.
 * @module security/purge
 */

/** Durée de conservation par défaut, en mois. */
export const RETENTION_MONTHS = 12;

/**
 * Sépare les soumissions à conserver de celles à purger.
 * Une soumission est purgée si sa date est strictement antérieure à `now - months`
 * ou si sa date est absente/illisible (minimisation des données).
 * @param {Array<Record<string, any>>} submissions Soumissions.
 * @param {{now?: Date | number, months?: number, dateField?: string}} [options]
 *   `dateField` : champ date (ISO ou timestamp), défaut `createdAt`.
 * @returns {{kept: Array<Record<string, any>>, purged: Array<Record<string, any>>}} Résultat.
 * @throws {Error} Si `submissions` n'est pas un tableau ou `months` invalide.
 */
export function purgeOldSubmissions(submissions, { now = Date.now(), months = RETENTION_MONTHS, dateField = 'createdAt' } = {}) {
  if (!Array.isArray(submissions)) throw new Error('Les soumissions doivent être fournies sous forme de tableau.');
  if (!Number.isInteger(months) || months < 1) throw new Error('La durée de conservation doit être un nombre entier de mois positif.');
  const seuil = new Date(now);
  seuil.setUTCMonth(seuil.getUTCMonth() - months);
  const limite = seuil.getTime();
  const kept = [];
  const purged = [];
  for (const s of submissions) {
    const t = s && s[dateField] !== undefined ? new Date(s[dateField]).getTime() : NaN;
    (Number.isFinite(t) && t >= limite ? kept : purged).push(s);
  }
  return { kept, purged };
}
