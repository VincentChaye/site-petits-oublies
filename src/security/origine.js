/**
 * Vérification d'origine des requêtes d'écriture (défense en profondeur devant le CSRF).
 *
 * Pourquoi `Origin` ne suffit pas : le site envoie `Referrer-Policy: no-referrer`, et
 * Chromium aligne l'en-tête `Origin` des envois de formulaire sur la politique de
 * référent — il envoie alors `Origin: null` pour une soumission **de même origine**.
 * Un contrôle fondé sur `Origin` seul refuse donc toute connexion depuis un vrai
 * navigateur. `Sec-Fetch-Site` est posé par le navigateur, n'est pas modifiable par
 * le code de la page et reste fiable : il est consulté en premier.
 *
 * @module security/origine
 */

/** Valeurs de `Sec-Fetch-Site` acceptées pour une écriture. */
const SITES_ACCEPTES = new Set(['same-origin', 'none']);

/**
 * @typedef {Object} VerdictOrigine
 * @property {boolean} ok Vrai si la requête peut être traitée.
 * @property {'sec-fetch-site'|'origin'|'absence'} source Ce qui a permis de décider.
 * @property {string} [motif] Motif du refus (journalisable : aucune donnée sensible).
 */

/**
 * Décide si une requête d'écriture provient bien du site lui-même.
 *
 * Ordre de décision :
 * 1. `Sec-Fetch-Site` présent → seules `same-origin` et `none` passent (tout
 *    `cross-site` ou `same-site` est refusé, même sans en-tête `Origin`) ;
 * 2. sinon `Origin` présent → son hôte doit être celui de `Host` ; `null` est refusé ;
 * 3. sinon (ni l'un ni l'autre : client non navigateur, tests, curl) → accepté,
 *    le jeton CSRF restant la protection principale.
 *
 * @param {{headers?: Record<string, string | string[] | undefined>}} req Requête.
 * @returns {VerdictOrigine} Verdict.
 */
export function verifierMemeOrigine(req) {
  const h = req?.headers ?? {};
  const premier = (v) => (Array.isArray(v) ? v[0] : v);
  const site = premier(h['sec-fetch-site']);

  if (typeof site === 'string' && site !== '') {
    return SITES_ACCEPTES.has(site)
      ? { ok: true, source: 'sec-fetch-site' }
      : { ok: false, source: 'sec-fetch-site', motif: `Sec-Fetch-Site refusé : ${site}` };
  }

  const origin = premier(h.origin);
  if (typeof origin === 'string' && origin !== '') {
    if (origin === 'null') return { ok: false, source: 'origin', motif: 'Origin opaque (null) sans Sec-Fetch-Site' };
    let hote;
    try {
      hote = new URL(origin).host;
    } catch {
      return { ok: false, source: 'origin', motif: 'Origin illisible' };
    }
    return hote === premier(h.host)
      ? { ok: true, source: 'origin' }
      : { ok: false, source: 'origin', motif: 'Origin différent de Host' };
  }

  return { ok: true, source: 'absence' };
}
