/**
 * Anti-spam des formulaires publics : honeypot, jeton HMAC horodaté et
 * limitation de débit en mémoire par IP (l'IP n'est jamais écrite sur disque).
 * @module security/antispam
 */
import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

/** Nom par défaut du champ piège (invisible pour les humains). */
export const HONEYPOT_FIELD = 'website';

/**
 * Vérifie le honeypot : le champ doit être absent ou vide.
 * @param {Record<string, unknown> | null | undefined} body Corps du formulaire.
 * @param {string} [field=HONEYPOT_FIELD] Nom du champ piège.
 * @returns {boolean} Vrai si le champ est vide (humain probable), faux si rempli (robot).
 */
export function honeypotPassed(body, field = HONEYPOT_FIELD) {
  const v = body?.[field];
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

const signer = (secret, payload) => createHmac('sha256', secret).update(payload).digest('base64url');

/**
 * Émet un jeton de formulaire horodaté signé en HMAC-SHA256 (`horodatage.nonce.signature`).
 * @param {string} secret Secret serveur.
 * @param {number} [now=Date.now()] Horloge en ms.
 * @returns {string} Jeton à placer dans un champ caché.
 * @throws {Error} Si le secret est absent.
 */
export function issueFormToken(secret, now = Date.now()) {
  if (typeof secret !== 'string' || !secret) throw new Error('Le secret anti-spam est requis.');
  const payload = `${Math.floor(now)}.${randomBytes(8).toString('base64url')}`;
  return `${payload}.${signer(secret, payload)}`;
}

/**
 * @typedef {Object} TokenCheck
 * @property {boolean} ok Vrai si le jeton est accepté.
 * @property {string} [message] Motif du refus, en français.
 */

/**
 * Vérifie un jeton de formulaire : signature, délai minimal (anti-robot) et maximal (expiration).
 * @param {unknown} token Jeton soumis.
 * @param {string} secret Secret serveur.
 * @param {{minDelayMs?: number, maxAgeMs?: number, now?: number}} [options] Délais (défaut 3 s / 2 h).
 * @returns {TokenCheck} Résultat.
 */
export function verifyFormToken(token, secret, { minDelayMs = 3000, maxAgeMs = 2 * 3600 * 1000, now = Date.now() } = {}) {
  if (typeof token !== 'string' || typeof secret !== 'string' || !secret) {
    return { ok: false, message: 'Jeton de formulaire manquant.' };
  }
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, message: 'Jeton de formulaire invalide.' };
  const [ts, nonce, sig] = parts;
  const attendu = Buffer.from(signer(secret, `${ts}.${nonce}`));
  const recu = Buffer.from(sig);
  if (attendu.length !== recu.length || !timingSafeEqual(attendu, recu)) {
    return { ok: false, message: 'Jeton de formulaire invalide.' };
  }
  const age = now - Number(ts);
  if (!Number.isFinite(age) || age < 0) return { ok: false, message: 'Jeton de formulaire invalide.' };
  if (age < minDelayMs) return { ok: false, message: 'Formulaire envoyé trop rapidement. Veuillez réessayer.' };
  if (age > maxAgeMs) return { ok: false, message: 'Formulaire expiré. Veuillez recharger la page.' };
  return { ok: true };
}

/**
 * @typedef {Object} RateLimiter
 * @property {(ip: string) => {allowed: boolean, retryAfterSec: number}} check Enregistre une tentative.
 * @property {() => void} sweep Purge les entrées expirées.
 */

/**
 * Limiteur de débit en mémoire (fenêtre glissante). Les IP sont hachées avec un sel
 * aléatoire propre au processus et ne sont jamais écrites sur disque.
 * @param {{max?: number, windowMs?: number, now?: () => number}} [options] Max de requêtes par fenêtre (défaut 5 / 1 h).
 * @returns {RateLimiter} Limiteur.
 * @throws {Error} Si max ou windowMs sont invalides.
 */
export function createRateLimiter({ max = 5, windowMs = 3600 * 1000, now = Date.now } = {}) {
  if (!Number.isInteger(max) || max < 1 || !Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error('Paramètres de limitation de débit invalides.');
  }
  const sel = randomBytes(16);
  /** @type {Map<string, number[]>} */
  const hits = new Map();
  const cle = (ip) => createHash('sha256').update(sel).update(String(ip)).digest('base64url');
  const sweep = () => {
    const limite = now() - windowMs;
    for (const [k, v] of hits) {
      const r = v.filter((t) => t > limite);
      if (r.length) hits.set(k, r); else hits.delete(k);
    }
  };
  return {
    check(ip) {
      const t = now();
      const k = cle(ip);
      const recents = (hits.get(k) ?? []).filter((x) => x > t - windowMs);
      if (recents.length >= max) {
        hits.set(k, recents);
        return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((recents[0] + windowMs - t) / 1000)) };
      }
      recents.push(t);
      hits.set(k, recents);
      return { allowed: true, retryAfterSec: 0 };
    },
    sweep,
  };
}

/**
 * @typedef {Object} FailureLimiter
 * @property {(key: string) => {blocked: boolean, retryAfterSec: number}} status Consulte l'état SANS rien compter.
 * @property {(key: string) => void} recordFailure Enregistre un échec.
 * @property {(key: string) => void} reset Efface les échecs de la clé (après un succès).
 * @property {() => void} sweep Purge les entrées expirées.
 */

/**
 * Limiteur qui ne compte QUE les échecs (ex. connexion). Une clé est bloquée
 * lorsqu'elle a cumulé `max` échecs dans la fenêtre. Les clés (ex. IP) sont
 * hachées avec un sel propre au processus, gardées en mémoire uniquement et jamais journalisées.
 * @param {{max?: number, windowMs?: number, maxKeys?: number, now?: () => number}} [options] Paramètres.
 * @returns {FailureLimiter} Limiteur.
 * @throws {Error} Si les paramètres sont invalides.
 */
export function createFailureLimiter({ max = 10, windowMs = 15 * 60 * 1000, maxKeys = 10000, now = Date.now } = {}) {
  if (!Number.isInteger(max) || max < 1 || !Number.isFinite(windowMs) || windowMs <= 0 || !Number.isInteger(maxKeys) || maxKeys < 1) {
    throw new Error('Paramètres de limitation des échecs invalides.');
  }
  const sel = randomBytes(16);
  /** @type {Map<string, number[]>} */
  const echecs = new Map();
  const cle = (k) => createHash('sha256').update(sel).update(String(k)).digest('base64url');
  const recents = (k, t) => (echecs.get(k) ?? []).filter((x) => x > t - windowMs);
  const sweep = () => {
    const t = now();
    for (const k of [...echecs.keys()]) {
      const r = recents(k, t);
      if (r.length) echecs.set(k, r); else echecs.delete(k);
    }
  };
  return {
    status(key) {
      const t = now();
      const r = recents(cle(key), t);
      if (r.length < max) return { blocked: false, retryAfterSec: 0 };
      return { blocked: true, retryAfterSec: Math.max(1, Math.ceil((r[0] + windowMs - t) / 1000)) };
    },
    recordFailure(key) {
      const t = now();
      const k = cle(key);
      if (!echecs.has(k) && echecs.size >= maxKeys) {
        sweep();
        if (echecs.size >= maxKeys) echecs.delete(echecs.keys().next().value); // borne mémoire
      }
      const r = recents(k, t);
      r.push(t);
      echecs.set(k, r);
    },
    reset(key) {
      echecs.delete(cle(key));
    },
    sweep,
  };
}
