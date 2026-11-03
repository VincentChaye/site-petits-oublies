/**
 * Validation des besoins en matériel et de l'agenda des collectes, saisis
 * depuis /interne/soutien. Même moule que `animaux-validation.js` : liste
 * blanche stricte, construction par littéral, rejet des clés dangereuses.
 * @module server/soutien-validation
 */

/** Champs acceptés pour un besoin. */
export const CHAMPS_BESOIN = Object.freeze(['id', 'titre', 'detail']);
/** Champs acceptés pour une collecte. */
export const CHAMPS_COLLECTE = Object.freeze(['id', 'date', 'lieu', 'ville', 'horaires', 'detail']);
const CHAMPS_TECHNIQUES = Object.freeze(['_csrf', '_version']);

const INTERDITES = new Set(['__proto__', 'constructor', 'prototype']);
export const RE_ID = /^[a-z0-9-]{2,60}$/;
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Bornes de longueur, par champ. */
const MAX = Object.freeze({ titre: 120, detail: 500, lieu: 120, ville: 80, horaires: 80 });
/** Nombre maximal d'entrées : borne la taille du fichier écrit. */
export const MAX_ENTREES = 60;

/** Texte d'une seule ligne, sans caractère de contrôle. */
const ligne = (v) => (typeof v === 'string' ? v.normalize('NFC').replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ').replace(/ {2,}/g, ' ').trim() : '');

/** Refuse tout champ hors liste blanche, et les clés dangereuses. */
function champsPermis(source, permis) {
  for (const cle of Object.keys(source)) {
    if (INTERDITES.has(cle)) return 'Requête refusée : champ interdit dans la saisie.';
    if (!permis.includes(cle) && !CHAMPS_TECHNIQUES.includes(cle)) return `Champ non autorisé : « ${cle.slice(0, 40)} ».`;
  }
  return null;
}

/** Identifiant : saisi s'il est fourni, sinon dérivé du titre puis rendu unique. */
function identifiant(brut, repli, existants) {
  const propose = ligne(brut).toLowerCase();
  let base = RE_ID.test(propose) ? propose : ligne(repli).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  if (!RE_ID.test(base)) base = 'entree';
  let id = base;
  let n = 2;
  while (existants.has(id)) { id = `${base}-${n}`; n += 1; }
  return id;
}

/**
 * Valide un besoin en matériel.
 * @param {Record<string, unknown>} corps Corps de requête.
 * @param {{existants?: Set<string>}} [ctx]
 * @returns {{valeurs: Record<string,string>, erreurs: Record<string,string>, besoin: Object|null}}
 */
export function validerBesoin(corps, { existants = new Set() } = {}) {
  const source = corps && typeof corps === 'object' ? corps : {};
  const erreurs = {};
  const refus = champsPermis(source, CHAMPS_BESOIN);
  if (refus) return { valeurs: {}, erreurs: { _general: refus }, besoin: null };

  const valeurs = {};
  for (const cle of CHAMPS_BESOIN) {
    const brut = Object.hasOwn(source, cle) ? source[cle] : '';
    if (typeof brut !== 'string') erreurs[cle] = 'Valeur invalide.';
    valeurs[cle] = ligne(brut);
  }
  if (!valeurs.titre) erreurs.titre ??= 'Le titre du besoin est obligatoire.';
  else if ([...valeurs.titre].length > MAX.titre) erreurs.titre = `Le titre ne doit pas dépasser ${MAX.titre} caractères.`;
  if ([...valeurs.detail].length > MAX.detail) erreurs.detail ??= `Le détail ne doit pas dépasser ${MAX.detail} caractères.`;

  if (Object.keys(erreurs).length) return { valeurs, erreurs, besoin: null };
  return { valeurs, erreurs, besoin: { id: identifiant(valeurs.id, valeurs.titre, existants), titre: valeurs.titre, detail: valeurs.detail } };
}

/**
 * Valide une collecte.
 * @param {Record<string, unknown>} corps Corps de requête.
 * @param {{existants?: Set<string>}} [ctx]
 * @returns {{valeurs: Record<string,string>, erreurs: Record<string,string>, collecte: Object|null}}
 */
export function validerCollecte(corps, { existants = new Set() } = {}) {
  const source = corps && typeof corps === 'object' ? corps : {};
  const erreurs = {};
  const refus = champsPermis(source, CHAMPS_COLLECTE);
  if (refus) return { valeurs: {}, erreurs: { _general: refus }, collecte: null };

  const valeurs = {};
  for (const cle of CHAMPS_COLLECTE) {
    const brut = Object.hasOwn(source, cle) ? source[cle] : '';
    if (typeof brut !== 'string') erreurs[cle] = 'Valeur invalide.';
    valeurs[cle] = ligne(brut);
  }
  if (!valeurs.date) erreurs.date ??= 'La date est obligatoire.';
  else if (!RE_DATE.test(valeurs.date) || Number.isNaN(Date.parse(`${valeurs.date}T12:00:00Z`))) {
    erreurs.date ??= 'La date doit être au format AAAA-MM-JJ et exister.';
  }
  if (!valeurs.lieu) erreurs.lieu ??= 'Le lieu est obligatoire (nom du magasin, par exemple).';
  for (const cle of ['lieu', 'ville', 'horaires', 'detail']) {
    const max = MAX[cle] ?? MAX.detail;
    if ([...valeurs[cle]].length > max) erreurs[cle] ??= `Ce champ ne doit pas dépasser ${max} caractères.`;
  }

  if (Object.keys(erreurs).length) return { valeurs, erreurs, collecte: null };
  return {
    valeurs,
    erreurs,
    collecte: {
      id: identifiant(valeurs.id, `${valeurs.date}-${valeurs.lieu}`, existants),
      date: valeurs.date,
      lieu: valeurs.lieu,
      ville: valeurs.ville,
      horaires: valeurs.horaires,
      detail: valeurs.detail,
    },
  };
}
