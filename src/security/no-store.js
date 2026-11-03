/**
 * Empêche la mise en cache et l'indexation des réponses de l'espace interne
 * (pages, erreurs, redirections, export CSV). S'ajoute aux en-têtes existants.
 * @module security/no-store
 */

/**
 * @param {{prefixe?: string}} [options] Préfixe de chemin protégé (défaut `/interne`).
 * @returns {import('express').RequestHandler} Middleware à monter AVANT les routeurs.
 */
export function noStoreMiddleware({ prefixe = '/interne' } = {}) {
  return (req, res, next) => {
    const chemin = req.path;
    if (chemin === prefixe || chemin.startsWith(`${prefixe}/`)) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Robots-Tag', 'noindex');
    }
    next();
  };
}
