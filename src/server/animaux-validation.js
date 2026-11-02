/**
 * Validation des fiches animaux saisies depuis /interne.
 * Liste blanche stricte des champs ; construction de la fiche par littéral (jamais de
 * recopie générique de la saisie) ; rejet de __proto__ / constructor / prototype.
 * @module server/animaux-validation
 */
import { LIBELLES_ESPECE, LIBELLES_TRANCHE, LIBELLES_TAILLE } from './content.js';

/** Champs de fiche acceptés dans le formulaire (hors _csrf et _version). */
export const CHAMPS_FICHE = Object.freeze([
  'slug', 'nom', 'espece', 'race', 'age', 'tranche', 'taille', 'sexe', 'dateArrivee',
  'statut', 'caractere', 'besoins', 'histoire', 'photo_src', 'photo_alt',
]);
/** Champs techniques acceptés en plus. */
const CHAMPS_TECHNIQUES = Object.freeze(['_csrf', '_version']);
/** Champs obligatoires (déduits des fiches existantes et de leur usage dans les vues/intégrations). */
export const CHAMPS_OBLIGATOIRES = Object.freeze([
  'slug', 'nom', 'espece', 'race', 'age', 'tranche', 'taille', 'sexe', 'dateArrivee',
  'statut', 'caractere', 'besoins', 'histoire',
]);
export const STATUTS = Object.freeze({ disponible: 'Disponible', adopte: 'Adopté' });
export const SEXES = Object.freeze({ femelle: 'Femelle', 'mâle': 'Mâle' });
export const RE_SLUG = /^[a-z0-9-]{2,60}$/;

const INTERDITES = new Set(['__proto__', 'constructor', 'prototype']);
const LIBELLES = Object.freeze({
  slug: 'Identifiant (slug)', nom: 'Nom', espece: 'Espèce', race: 'Race', age: 'Âge', tranche: 'Tranche d’âge',
  taille: 'Taille', sexe: 'Sexe', dateArrivee: 'Date d’arrivée', statut: 'Statut', caractere: 'Caractère',
  besoins: 'Besoins', histoire: 'Histoire', photo_src: 'Chemin de la photo', photo_alt: 'Description de la photo',
});
const LONGUEURS = Object.freeze({ nom: 60, race: 80, caractere: 2000, besoins: 2000, histoire: 2000, photo_alt: 300 });

/**
 * @param {Record<string, unknown>} corps Corps de requête.
 * @param {{creation: boolean, slugActuel?: string, slugsExistants?: Set<string>}} ctx
 * @returns {{valeurs: Record<string,string>, erreurs: Record<string,string>, fiche: Object|null, version: number|null}}
 */
export function validerFiche(corps, { creation, slugActuel, slugsExistants = new Set() }) {
  const erreurs = {};
  const valeurs = {};
  const source = corps && typeof corps === 'object' ? corps : {};

  for (const cle of Object.keys(source)) {
    if (INTERDITES.has(cle)) {
      erreurs._general = 'Requête refusée : champ interdit dans la saisie.';
    } else if (!CHAMPS_FICHE.includes(cle) && !CHAMPS_TECHNIQUES.includes(cle)) {
      erreurs._general = `Champ non autorisé : « ${cle.slice(0, 40)} ».`;
    }
  }
  if (erreurs._general) return { valeurs, erreurs, fiche: null, version: null };

  for (const cle of CHAMPS_FICHE) {
    const brut = Object.hasOwn(source, cle) ? source[cle] : '';
    if (typeof brut !== 'string') {
      valeurs[cle] = '';
      erreurs[cle] = `${LIBELLES[cle]} : valeur invalide.`;
    } else {
      valeurs[cle] = brut.trim();
    }
  }

  // Slug : saisi, jamais déduit ; immuable après création.
  if (creation) {
    if (!valeurs.slug) erreurs.slug ??= 'L’identifiant (slug) est obligatoire.';
    else if (!RE_SLUG.test(valeurs.slug)) erreurs.slug = 'L’identifiant (slug) doit comporter 2 à 60 caractères : lettres minuscules sans accent, chiffres et tirets.';
    else if (slugsExistants.has(valeurs.slug)) erreurs.slug = 'Cet identifiant (slug) est déjà utilisé par une autre fiche.';
  } else if (valeurs.slug && valeurs.slug !== slugActuel) {
    erreurs.slug = 'L’identifiant (slug) ne peut pas être modifié après la création.';
  }

  for (const cle of CHAMPS_OBLIGATOIRES) {
    if (cle === 'slug') continue;
    if (!valeurs[cle] && !erreurs[cle]) erreurs[cle] = `${LIBELLES[cle]} est obligatoire.`;
  }
  for (const [cle, max] of Object.entries(LONGUEURS)) {
    if (valeurs[cle].length > max && !erreurs[cle]) erreurs[cle] = `${LIBELLES[cle]} : ${max} caractères au maximum.`;
  }
  const enums = { espece: LIBELLES_ESPECE, tranche: LIBELLES_TRANCHE, taille: LIBELLES_TAILLE, sexe: SEXES, statut: STATUTS };
  for (const [cle, liste] of Object.entries(enums)) {
    if (valeurs[cle] && !Object.hasOwn(liste, valeurs[cle])) erreurs[cle] = `${LIBELLES[cle]} : valeur non reconnue (${Object.keys(liste).join(', ')}).`;
  }
  if (valeurs.age && !/^\d{1,2}$/.test(valeurs.age)) erreurs.age = 'L’âge doit être un nombre entier d’années (0 à 99).';
  if (valeurs.dateArrivee && !erreurs.dateArrivee) {
    const d = new Date(`${valeurs.dateArrivee}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(valeurs.dateArrivee) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== valeurs.dateArrivee) {
      erreurs.dateArrivee = 'La date d’arrivée doit être une date valide au format AAAA-MM-JJ.';
    }
  }

  // Photo (facultative) : chemin /img/…, sans « .. ».
  if (valeurs.photo_src && !erreurs.photo_src) {
    if (!valeurs.photo_src.startsWith('/img/') || valeurs.photo_src.includes('..') || !/^\/img\/[A-Za-z0-9._\/-]+$/.test(valeurs.photo_src)) {
      erreurs.photo_src = 'Le chemin de la photo doit commencer par /img/, ne pas contenir « .. » et n’utiliser que lettres, chiffres, point, tiret, souligné et barre oblique.';
    } else if (!valeurs.photo_alt) {
      erreurs.photo_alt = 'La description de la photo est obligatoire quand une photo est indiquée.';
    }
  }

  // Version (modification) : entier positif ou nul.
  let version = null;
  if (!creation) {
    const v = Object.hasOwn(source, '_version') ? source._version : undefined;
    if (typeof v !== 'string' || !/^\d{1,9}$/.test(v.trim())) erreurs._version = 'Version de la fiche manquante ou invalide : rechargez la page.';
    else version = Number(v);
  }

  if (Object.keys(erreurs).length) return { valeurs, erreurs, fiche: null, version };

  const fiche = {
    slug: creation ? valeurs.slug : slugActuel,
    nom: valeurs.nom,
    espece: valeurs.espece,
    race: valeurs.race,
    age: Number(valeurs.age),
    tranche: valeurs.tranche,
    taille: valeurs.taille,
    sexe: valeurs.sexe,
    dateArrivee: valeurs.dateArrivee,
    statut: valeurs.statut,
    caractere: valeurs.caractere,
    besoins: valeurs.besoins,
    histoire: valeurs.histoire,
    photos: valeurs.photo_src ? [{ src: valeurs.photo_src, alt: valeurs.photo_alt }] : [],
  };
  return { valeurs, erreurs, fiche, version };
}
