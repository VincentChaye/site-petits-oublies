/**
 * Protection CSRF liée à la session interne.
 * @module security/csrf
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { verifierMemeOrigine } from './origine.js';

const METHODES_PROTEGEES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Calcule le jeton CSRF (HMAC-SHA256, base64url) d'une session.
 * @param {string} sessionToken Jeton de session.
 * @param {string} secret Secret serveur.
 * @returns {string} Jeton CSRF.
 */
export function csrfTokenFor(sessionToken, secret) {
  return createHmac('sha256', secret).update(sessionToken).digest('base64url');
}

/**
 * Vérifie un jeton CSRF à temps constant. Ne lève jamais pour des entrées invalides.
 * @param {unknown} sessionToken Jeton de session.
 * @param {unknown} submittedToken Jeton soumis.
 * @param {string} secret Secret serveur.
 * @returns {boolean} Vrai si valide.
 */
export function verifyCsrf(sessionToken, submittedToken, secret) {
  if (typeof sessionToken !== 'string' || !sessionToken) return false;
  if (typeof submittedToken !== 'string' || !submittedToken) return false;
  const a = Buffer.from(csrfTokenFor(sessionToken, secret));
  const b = Buffer.from(submittedToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

function refuser(res, message) {
  res.statusCode = 403;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(message);
}

/**
 * Middleware style Express : exige le jeton CSRF (champ `_csrf` du body ou en-tête
 * `x-csrf-token`) sur POST/PUT/PATCH/DELETE, et contrôle la provenance de la requête
 * via {@link verifierMemeOrigine} (Sec-Fetch-Site d'abord, Origin vs Host ensuite).
 * À placer après `requireSession` (utilise `req.sessionToken`). Répond 403 en français.
 * @param {{secret: string}} options Secret serveur.
 * @returns {(req: any, res: any, next: (err?: unknown) => void) => void} Middleware.
 * @throws {Error} Si le secret est absent.
 */
export function csrfProtection({ secret } = {}) {
  if (typeof secret !== 'string' || !secret) {
    throw new Error('Le secret CSRF est requis.');
  }
  return (req, res, next) => {
    if (!METHODES_PROTEGEES.has(String(req.method).toUpperCase())) return next();

    // Provenance : Sec-Fetch-Site est prioritaire. Un navigateur recevant
    // `Referrer-Policy: no-referrer` envoie `Origin: null` sur un POST de même
    // origine ; s'en tenir à Origin refuserait toutes les écritures internes.
    if (!verifierMemeOrigine(req).ok) {
      return refuser(res, 'Requête refusée : origine non autorisée.');
    }

    const soumis = req.body?._csrf ?? req.headers?.['x-csrf-token'];
    if (!verifyCsrf(req.sessionToken, soumis, secret)) {
      return refuser(res, 'Requête refusée : jeton CSRF invalide ou manquant.');
    }
    next();
  };
}
