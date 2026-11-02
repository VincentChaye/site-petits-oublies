/**
 * Chargement et validation de la configuration de sécurité.
 * Aucun secret en dur : tout provient des variables d'environnement.
 * @module security/config
 */

const LONGUEUR_MIN_SECRET = 32;
const VALEUR_EXEMPLE = 'CHANGEZ-MOI';

/**
 * @typedef {Object} SecurityConfig
 * @property {string} internalSecret Secret de l'espace interne (≥ 32 caractères).
 * @property {boolean} isProduction Vrai si NODE_ENV === 'production'.
 */

/**
 * Charge la configuration de sécurité et refuse de démarrer si elle est invalide.
 * Les messages d'erreur ne contiennent jamais le secret.
 * @param {Record<string, string | undefined>} [env=process.env] Variables d'environnement.
 * @returns {Readonly<SecurityConfig>} Configuration figée.
 * @throws {Error} Si INTERNAL_SECRET est absent, trop court ou égal à la valeur d'exemple.
 */
export function loadSecurityConfig(env = process.env) {
  const secret = env.INTERNAL_SECRET;
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error("INTERNAL_SECRET est absent : définissez-le dans l'environnement.");
  }
  if (secret.toUpperCase().startsWith(VALEUR_EXEMPLE)) {
    throw new Error("INTERNAL_SECRET utilise la valeur d'exemple : choisissez un secret unique.");
  }
  if (secret.length < LONGUEUR_MIN_SECRET) {
    throw new Error(`INTERNAL_SECRET est trop court : ${LONGUEUR_MIN_SECRET} caractères minimum requis.`);
  }
  return Object.freeze({
    internalSecret: secret,
    isProduction: env.NODE_ENV === 'production',
  });
}
