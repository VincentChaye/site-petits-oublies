/**
 * En-têtes de sécurité HTTP. La CSP interdit tout script/style inline ;
 * un bloc `<script type="application/ld+json">` reste compatible car ce
 * n'est pas un script exécutable (aucune directive script-src ne s'y applique).
 * @module security/headers
 */

/**
 * Politique de contenu (CSP) sans 'unsafe-inline'.
 * @type {string}
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/**
 * Retourne les en-têtes de sécurité à poser sur toutes les réponses.
 * @param {{isProduction?: boolean}} [options] HSTS ajouté en production.
 * @returns {Record<string, string>} En-têtes (nom → valeur).
 */
export function securityHeaders({ isProduction = false } = {}) {
  const h = {
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  };
  if (isProduction) h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return h;
}

/**
 * Middleware style Express posant les en-têtes de sécurité.
 * @param {{isProduction?: boolean}} [options] Options de {@link securityHeaders}.
 * @returns {(req: any, res: any, next: (err?: unknown) => void) => void} Middleware.
 */
export function securityHeadersMiddleware(options) {
  const entetes = Object.entries(securityHeaders(options));
  return (_req, res, next) => {
    for (const [k, v] of entetes) res.setHeader(k, v);
    next();
  };
}
