/**
 * Authentification de l'espace interne : sessions en mémoire et cookie.
 * Le cookie de session n'est posé que sur le chemin /interne ; les routes
 * publiques ne doivent JAMAIS émettre de Set-Cookie.
 * @module security/session
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Nom du cookie de session. */
export const SESSION_COOKIE_NAME = 'sid';
/** Chemin exclusif du cookie. */
export const SESSION_PATH = '/interne';

const sha256 = (v) => createHash('sha256').update(v).digest();

/**
 * Compare deux secrets à temps constant (hachage SHA-256 puis timingSafeEqual).
 * Ne lève jamais : tout type non chaîne donne false.
 * @param {unknown} candidate Valeur fournie.
 * @param {unknown} expected Valeur attendue.
 * @returns {boolean} Vrai si identiques.
 */
export function verifySecret(candidate, expected) {
  if (typeof candidate !== 'string' || typeof expected !== 'string') return false;
  if (expected.length === 0) return false;
  return timingSafeEqual(sha256(candidate), sha256(expected));
}

/**
 * @typedef {Object} SessionStore
 * @property {() => string} create Crée une session et renvoie son jeton.
 * @property {(token: unknown) => boolean} validate Vrai si le jeton existe et n'est pas expiré.
 * @property {(token: unknown) => void} destroy Supprime la session.
 * @property {(oldToken: unknown) => string} regenerate Invalide l'ancien jeton et en émet un nouveau.
 */

/**
 * Crée un magasin de sessions en mémoire.
 * @param {{ttlMs: number, now?: () => number}} options Durée de vie en ms ; `now` injectable pour les tests.
 * @returns {SessionStore} Magasin de sessions.
 * @throws {Error} Si ttlMs n'est pas un nombre positif.
 */
export function createSessionStore({ ttlMs, now = Date.now } = {}) {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error('ttlMs doit être un nombre strictement positif.');
  }
  /** @type {Map<string, number>} */
  const sessions = new Map();
  return {
    create() {
      const token = randomBytes(32).toString('base64url');
      sessions.set(token, now() + ttlMs);
      return token;
    },
    validate(token) {
      if (typeof token !== 'string') return false;
      const exp = sessions.get(token);
      if (exp === undefined) return false;
      if (now() >= exp) {
        sessions.delete(token);
        return false;
      }
      return true;
    },
    destroy(token) {
      if (typeof token === 'string') sessions.delete(token);
    },
    regenerate(oldToken) {
      if (typeof oldToken === 'string') sessions.delete(oldToken);
      return this.create();
    },
  };
}

/**
 * Construit l'en-tête Set-Cookie de session.
 * @param {string} token Jeton de session.
 * @param {{isProduction?: boolean, maxAgeSec?: number}} [options] Secure ajouté en production.
 * @returns {string} Valeur de Set-Cookie.
 */
export function sessionCookieHeader(token, { isProduction = false, maxAgeSec } = {}) {
  const parts = [`${SESSION_COOKIE_NAME}=${token}`, 'HttpOnly', 'SameSite=Strict', `Path=${SESSION_PATH}`];
  if (Number.isFinite(maxAgeSec)) parts.push(`Max-Age=${Math.floor(maxAgeSec)}`);
  if (isProduction) parts.push('Secure');
  return parts.join('; ');
}

/**
 * Construit l'en-tête Set-Cookie qui efface le cookie de session.
 * @param {{isProduction?: boolean}} [options] Secure ajouté en production.
 * @returns {string} Valeur de Set-Cookie.
 */
export function clearSessionCookieHeader({ isProduction = false } = {}) {
  const parts = [`${SESSION_COOKIE_NAME}=`, 'HttpOnly', 'SameSite=Strict', `Path=${SESSION_PATH}`, 'Max-Age=0'];
  if (isProduction) parts.push('Secure');
  return parts.join('; ');
}

/**
 * Pose le cookie de session sur la réponse, uniquement pour un chemin /interne.
 * Les routes publiques ne doivent jamais émettre de Set-Cookie.
 * @param {{path?: string, originalUrl?: string, url?: string}} req Requête (chemin vérifié).
 * @param {{setHeader: (n: string, v: string) => void}} res Réponse.
 * @param {string} token Jeton de session.
 * @param {{isProduction?: boolean, maxAgeSec?: number}} [opts] Options du cookie.
 * @returns {void}
 * @throws {Error} Si le chemin de la requête n'est pas sous /interne.
 */
export function attachSessionCookie(req, res, token, opts) {
  const path = String(req?.path ?? req?.originalUrl ?? req?.url ?? '').split('?')[0];
  if (path !== SESSION_PATH && !path.startsWith(`${SESSION_PATH}/`)) {
    throw new Error('Refus : le cookie de session ne peut être émis que sur le chemin /interne.');
  }
  res.setHeader('Set-Cookie', sessionCookieHeader(token, opts));
}

/**
 * Lit le cookie de session dans l'en-tête Cookie (analyseur minimal).
 * @param {string | undefined} header Valeur de l'en-tête Cookie.
 * @returns {string | undefined} Jeton ou undefined.
 */
export function readSessionToken(header) {
  if (typeof header !== 'string') return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === SESSION_COOKIE_NAME) return part.slice(i + 1).trim();
  }
  return undefined;
}

/**
 * Middleware style Express : exige une session valide, sinon 401.
 * Place le jeton dans `req.sessionToken`.
 * @param {SessionStore} store Magasin de sessions.
 * @returns {(req: any, res: any, next: (err?: unknown) => void) => void} Middleware.
 */
export function requireSession(store) {
  return (req, res, next) => {
    const token = readSessionToken(req.headers?.cookie);
    if (!token || !store.validate(token)) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Authentification requise.');
      return;
    }
    req.sessionToken = token;
    next();
  };
}
