/**
 * Validation et assainissement des formulaires publics.
 * L'assainissement supprime les caractères de contrôle et normalise les espaces ;
 * l'échappement HTML reste à faire à l'affichage (jamais d'HTML brut injecté).
 * @module security/validation
 */

/** Longueur maximale d'une adresse e-mail (RFC 5321). */
const EMAIL_MAX = 254;
const EMAIL_RE = /^[^\s@<>"',;:()[\]\\]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/** Contrôles C0/C1, séparateurs de ligne et de paragraphe Unicode (propriétés, aucun littéral). */
const CONTROLES = /[\p{Cc}\p{Zl}\p{Zp}]/gu;
/** Idem, mais en conservant le saut de ligne \n. */
const CONTROLES_SAUF_LF = /(?!\n)[\p{Cc}\p{Zl}\p{Zp}]/gu;

/**
 * @typedef {Object} FieldRule
 * @property {string} label Libellé français.
 * @property {boolean} [required] Obligatoire.
 * @property {number} max Longueur maximale.
 * @property {number} [min] Longueur minimale.
 * @property {'text'|'email'|'multiline'|'consent'|'enum'|'slug'} [kind] Type (défaut text).
 * @property {string[]} [values] Valeurs permises (kind enum).
 */

/** @type {Readonly<Record<string, Record<string, FieldRule>>>} */
export const FORM_SCHEMAS = Object.freeze({
  interet: {
    prenom: { label: 'Le prénom', required: true, min: 2, max: 100 },
    email: { label: "L'adresse e-mail", required: true, max: EMAIL_MAX, kind: 'email' },
    telephone: { label: 'Le téléphone', max: 20 },
    logement: { label: 'La description du logement', required: true, min: 2, max: 500, kind: 'multiline' },
    message: { label: 'Le message', required: true, min: 10, max: 2000, kind: 'multiline' },
    consentement: { label: 'Le consentement', required: true, max: 5, kind: 'consent' },
  },
  contact: {
    nom: { label: 'Le nom', required: true, min: 2, max: 100 },
    email: { label: "L'adresse e-mail", required: true, max: EMAIL_MAX, kind: 'email' },
    sujet: { label: 'Le sujet', required: true, min: 2, max: 150 },
    message: { label: 'Le message', required: true, min: 10, max: 5000, kind: 'multiline' },
    consentement: { label: 'Le consentement', required: true, max: 5, kind: 'consent' },
  },
  benevolat: {
    nom: { label: 'Le nom', required: true, min: 2, max: 100 },
    email: { label: "L'adresse e-mail", required: true, max: EMAIL_MAX, kind: 'email' },
    disponibilites: { label: 'Les disponibilités', required: true, min: 2, max: 500, kind: 'multiline' },
    envies: { label: 'Les envies', required: true, min: 2, max: 1000, kind: 'multiline' },
    consentement: { label: 'Le consentement', required: true, max: 5, kind: 'consent' },
  },
  don_parrainage: {
    nom: { label: 'Le nom', required: true, min: 2, max: 100 },
    email: { label: "L'adresse e-mail", required: true, max: EMAIL_MAX, kind: 'email' },
    type: { label: 'Le type de soutien', required: true, max: 20, kind: 'enum', values: ['don_materiel', 'parrainage'] },
    animal: { label: "L'animal à parrainer", max: 100, kind: 'slug' },
    message: { label: 'Le message', required: true, min: 2, max: 2000, kind: 'multiline' },
    consentement: { label: 'Le consentement', required: true, max: 5, kind: 'consent' },
  },
});

/**
 * Assainit une valeur : conversion en chaîne, normalisation NFC, suppression des
 * caractères de contrôle (retours à la ligne conservés si `multiline`), trim.
 * @param {unknown} value Valeur brute.
 * @param {boolean} [multiline=false] Conserver les sauts de ligne.
 * @returns {string} Chaîne assainie (vide si non textuelle).
 */
export function sanitizeText(value, multiline = false) {
  if (typeof value !== 'string') return '';
  let s = value.normalize('NFC').replace(/\r\n?/g, '\n');
  s = multiline
    ? s.replace(CONTROLES_SAUF_LF, '')
    : s.replace(CONTROLES, ' ').replace(/ {2,}/g, ' ');
  return s.trim();
}

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid Vrai si aucune erreur.
 * @property {Record<string, string>} errors Messages d'erreur français par champ.
 * @property {Record<string, string>} values Valeurs assainies (champs connus uniquement).
 */

/**
 * Valide et assainit un formulaire. Les champs inconnus sont ignorés ; le honeypot
 * et les jetons se traitent dans antispam.js.
 * @param {'interet'|'contact'|'benevolat'|'don_parrainage'} form Nom du formulaire.
 * @param {Record<string, unknown> | null | undefined} body Corps reçu.
 * @returns {ValidationResult} Résultat.
 * @throws {Error} Si le formulaire est inconnu.
 */
export function validateForm(form, body) {
  const schema = Object.hasOwn(FORM_SCHEMAS, form) ? FORM_SCHEMAS[form] : undefined;
  if (!schema) throw new Error(`Formulaire inconnu : ${String(form)}.`);
  const errors = {};
  const values = {};
  for (const [name, rule] of Object.entries(schema)) {
    const brut = body && Object.hasOwn(body, name) ? body[name] : undefined;
    const kind = rule.kind ?? 'text';
    let v;
    if (kind === 'consent') {
      v = brut === true || ['on', 'true', '1', 'oui'].includes(String(brut).toLowerCase()) ? 'oui' : '';
    } else {
      v = sanitizeText(brut, kind === 'multiline');
    }
    if (!v) {
      if (rule.required) {
        errors[name] = kind === 'consent' ? 'Votre consentement est obligatoire.' : `${rule.label} est obligatoire.`;
      }
      values[name] = '';
      continue;
    }
    values[name] = v;
    if (v.length > rule.max) errors[name] = `${rule.label} ne doit pas dépasser ${rule.max} caractères.`;
    else if (rule.min && v.length < rule.min) errors[name] = `${rule.label} doit contenir au moins ${rule.min} caractères.`;
    else if (kind === 'email' && !EMAIL_RE.test(v)) errors[name] = "L'adresse e-mail n'est pas valide.";
    else if (kind === 'enum' && !rule.values.includes(v)) errors[name] = `${rule.label} n'est pas valide.`;
    else if (kind === 'slug' && !/^[a-z0-9-]+$/.test(v)) errors[name] = `${rule.label} n'est pas valide.`;
    else if (name === 'telephone' && !/^[+\d][\d ().-]{5,}$/.test(v)) errors[name] = `${rule.label} n'est pas valide.`;
  }
  return { valid: Object.keys(errors).length === 0, errors, values };
}
