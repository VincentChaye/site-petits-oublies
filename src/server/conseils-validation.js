/**
 * Validation des fiches conseils saisies depuis /interne.
 * Même moule que `animaux-validation.js` : liste blanche stricte des champs,
 * construction de la fiche par littéral (jamais de recopie générique de la
 * saisie), rejet de __proto__ / constructor / prototype. Aucun HTML n'est
 * accepté : le texte est échappé à l'affichage, comme partout ailleurs.
 * @module server/conseils-validation
 */
import { TYPES_SECTION, TYPES_GRAPHIQUE } from './content.js';

/** Champs de la fiche acceptés dans le formulaire (hors _csrf et _version). */
export const CHAMPS_FICHE = Object.freeze(['slug', 'titre', 'resume', 'icone', 'outil', 'sections']);
const CHAMPS_TECHNIQUES = Object.freeze(['_csrf', '_version']);
/** Outils interactifs proposés par une fiche ('' = aucun). */
export const OUTILS = Object.freeze({ '': 'Aucun', glucides: 'Calculateur du taux de glucides' });
export const RE_SLUG = /^[a-z0-9-]{2,60}$/;

const INTERDITES = new Set(['__proto__', 'constructor', 'prototype']);
const LIBELLES = Object.freeze({
  slug: 'Identifiant (slug)', titre: 'Titre', resume: 'Résumé', icone: 'Icône', outil: 'Outil interactif', sections: 'Sections',
});
const LONGUEURS = Object.freeze({ titre: 120, resume: 400, icone: 30 });
/** Longueurs maximales à l'intérieur d'une section. */
const SECTION_MAX = Object.freeze({ titre: 160, texte: 4000, conseil: 2000, element: 300 });
/** Nombre maximal de sections et d'éléments de liste : borne les fichiers écrits. */
const MAX_SECTIONS = 40;
const MAX_ELEMENTS = 30;

/* Visuels (chiffres clés, barres, anneau) : bornes de saisie et nombre de
   données acceptées par type. Au-delà de 4 chiffres clés ou de 6 parts
   d'anneau le visuel devient illisible, d'où ces plafonds volontairement bas. */
const GRAPHIQUE_MAX = Object.freeze({ libelle: 80, chiffre: 24, unite: 8, note: 300, valeur: 1e6 });
const GRAPHIQUE_PARTS = Object.freeze({
  chiffres: { min: 1, max: 4 }, barres: { min: 1, max: 12 }, anneau: { min: 2, max: 6 },
});
/** Directives acceptées dans le corps d'un visuel, par type. */
const GRAPHIQUE_CLES = Object.freeze({
  chiffres: ['note'], barres: ['unite', 'max', 'repere', 'note'], anneau: ['unite', 'note'],
});

/** Libellés des types de section, pour le formulaire interne. */
export const LIBELLES_TYPE = Object.freeze({
  texte: 'Paragraphe', liste: 'Liste à puces', conseil: 'Encadré « conseil »',
  saviez_vous: 'Encadré « le saviez-vous ? »', probleme: 'Problème + conseil',
  chiffres: 'Chiffres clés (encadrés)', barres: 'Graphique en barres', anneau: 'Graphique en anneau',
});

/** Texte libre d'une section : contrôles supprimés, sauts de ligne conservés. */
const nettoyer = (v) => (typeof v === 'string' ? v.normalize('NFC').replace(/\r\n?/g, '\n').replace(/(?!\n)[\p{Cc}\p{Zl}\p{Zp}]/gu, '').trim() : '');
/** Texte d'une seule ligne. */
const ligne = (v) => (typeof v === 'string' ? v.normalize('NFC').replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ').replace(/ {2,}/g, ' ').trim() : '');

/** Nombre décimal d'un visuel : virgule acceptée, espaces fines ignorées. */
function nombreVisuel(brut) {
  const net = brut.replace(/[\u202F\u00A0\s]/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(net)) return NaN;
  const n = Number(net);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Lit le corps d'une section visuelle (`chiffres`, `barres`, `anneau`).
 * Les données s'écrivent une par ligne, « - libellé | valeur » ; les autres
 * lignes sont des directives « clé : valeur » (unite, max, repere, note).
 * La section est complétée sur place, champ par champ (jamais de recopie
 * générique de la saisie).
 * @param {string} type Type de visuel.
 * @param {string} corps Corps de la section.
 * @param {Object} section Section en construction.
 * @returns {string|null} Message d'erreur, ou null si la section est valide.
 */
function lireVisuel(type, corps, section) {
  const elements = [];
  const options = {};
  const cles = GRAPHIQUE_CLES[type];

  for (const brut of corps.split('\n')) {
    const l = brut.trim();
    if (!l) continue;

    if (/^[-*\u2022]/.test(l)) {
      const reste = l.replace(/^[-*\u2022]\s*/, '');
      const sep = reste.lastIndexOf('|');
      const libelle = sep >= 0 ? ligne(reste.slice(0, sep)) : '';
      const valeurBrute = sep >= 0 ? ligne(reste.slice(sep + 1)) : '';
      if (!libelle || !valeurBrute) return 'chaque donnée s’écrit « - libellé | valeur ».';
      if ([...libelle].length > GRAPHIQUE_MAX.libelle) return `un libellé dépasse ${GRAPHIQUE_MAX.libelle} caractères.`;
      if (type === 'chiffres') {
        if ([...valeurBrute].length > GRAPHIQUE_MAX.chiffre) return `un chiffre clé dépasse ${GRAPHIQUE_MAX.chiffre} caractères.`;
        elements.push({ libelle, valeur: valeurBrute });
      } else {
        const n = nombreVisuel(valeurBrute);
        if (Number.isNaN(n) || n > GRAPHIQUE_MAX.valeur) return `« ${valeurBrute.slice(0, 20)} » n’est pas un nombre positif.`;
        elements.push({ libelle, valeur: n });
      }
      continue;
    }

    const m = l.match(/^([a-zA-Zéè]+)\s*:\s*(.+)$/);
    const cle = m ? ligne(m[1]).toLowerCase().replace('é', 'e').replace('è', 'e') : '';
    if (!m || !cles.includes(cle)) {
      return `ligne « ${l.slice(0, 30)} » non comprise : écrivez « - libellé | valeur », ou ${cles.map((c) => `« ${c} : … »`).join(', ')}.`;
    }
    if (Object.hasOwn(options, cle)) return `la ligne « ${cle} » est écrite deux fois.`;
    options[cle] = ligne(m[2]);
  }

  const bornes = GRAPHIQUE_PARTS[type];
  if (elements.length < bornes.min) return `écrivez au moins ${bornes.min} ${bornes.min > 1 ? 'données' : 'donnée'} « - libellé | valeur ».`;
  if (elements.length > bornes.max) return `pas plus de ${bornes.max} données pour ce visuel.`;

  if (Object.hasOwn(options, 'unite') && [...options.unite].length > GRAPHIQUE_MAX.unite) {
    return `l’unité dépasse ${GRAPHIQUE_MAX.unite} caractères.`;
  }
  if (Object.hasOwn(options, 'note') && [...options.note].length > GRAPHIQUE_MAX.note) {
    return `la note dépasse ${GRAPHIQUE_MAX.note} caractères.`;
  }

  const plusGrande = type === 'chiffres' ? 0 : Math.max(...elements.map((e) => e.valeur));
  let max = null;
  if (Object.hasOwn(options, 'max')) {
    max = nombreVisuel(options.max);
    if (Number.isNaN(max) || max <= 0 || max > GRAPHIQUE_MAX.valeur) return '« max » doit être un nombre supérieur à zéro.';
    if (max < plusGrande) return `« max » (${max}) est inférieur à la plus grande valeur (${plusGrande}).`;
  }

  let repere = null;
  if (Object.hasOwn(options, 'repere')) {
    const sep = options.repere.indexOf('|');
    const valeur = nombreVisuel(sep >= 0 ? options.repere.slice(0, sep) : options.repere);
    const libelle = sep >= 0 ? ligne(options.repere.slice(sep + 1)) : '';
    if (Number.isNaN(valeur)) return '« repere » doit être un nombre, suivi au besoin de « | son explication ».';
    if (valeur > (max ?? plusGrande)) return 'le repère sort du graphique : augmentez « max ».';
    if ([...libelle].length > GRAPHIQUE_MAX.libelle) return `l’explication du repère dépasse ${GRAPHIQUE_MAX.libelle} caractères.`;
    repere = libelle ? { valeur, libelle } : { valeur };
  }

  if (type === 'anneau' && !plusGrande) return 'un anneau a besoin d’au moins une part supérieure à zéro.';

  section.elements = elements;
  if (Object.hasOwn(options, 'unite')) section.unite = options.unite;
  if (max !== null) section.max = max;
  if (repere) section.repere = repere;
  if (Object.hasOwn(options, 'note')) section.note = options.note;
  return null;
}

/**
 * Lit les sections saisies. Le formulaire les envoie sous forme de texte
 * structuré, une section par bloc séparé par une ligne « --- », dont la
 * première ligne est `type: titre`. Ce format tient dans un textarea, se relit
 * sans outil, et reste validé en liste blanche ici.
 * @param {string} brut Texte saisi.
 * @returns {{sections: Array<Object>, erreur: string|null}} Sections ou message d'erreur.
 */
export function lireSections(brut) {
  const texte = typeof brut === 'string' ? brut.replace(/\r\n?/g, '\n') : '';
  const blocs = texte.split(/^\s*---\s*$/m).map((b) => b.trim()).filter(Boolean);
  if (!blocs.length) return { sections: [], erreur: 'Écrivez au moins une section.' };
  if (blocs.length > MAX_SECTIONS) return { sections: [], erreur: `Pas plus de ${MAX_SECTIONS} sections par fiche.` };

  const sections = [];
  for (const [i, bloc] of blocs.entries()) {
    const lignes = bloc.split('\n');
    const entete = lignes[0] ?? '';
    const sep = entete.indexOf(':');
    const type = ligne(sep >= 0 ? entete.slice(0, sep) : entete).toLowerCase();
    if (!TYPES_SECTION.includes(type)) {
      return { sections: [], erreur: `Section ${i + 1} : type « ${type.slice(0, 30)} » inconnu. Types possibles : ${TYPES_SECTION.join(', ')}.` };
    }
    const titre = ligne(sep >= 0 ? entete.slice(sep + 1) : '');
    if (titre.length > SECTION_MAX.titre) return { sections: [], erreur: `Section ${i + 1} : titre trop long (${SECTION_MAX.titre} caractères maximum).` };

    const corps = lignes.slice(1).join('\n').trim();
    const section = { type };
    if (titre) section.titre = titre;

    if (type === 'liste') {
      const elements = corps.split('\n').map((l) => ligne(l.replace(/^[-*•]\s*/, ''))).filter(Boolean);
      if (!elements.length) return { sections: [], erreur: `Section ${i + 1} : une liste doit contenir au moins un élément.` };
      if (elements.length > MAX_ELEMENTS) return { sections: [], erreur: `Section ${i + 1} : pas plus de ${MAX_ELEMENTS} éléments.` };
      if (elements.some((e) => e.length > SECTION_MAX.element)) return { sections: [], erreur: `Section ${i + 1} : un élément dépasse ${SECTION_MAX.element} caractères.` };
      section.elements = elements;
    } else if (TYPES_GRAPHIQUE.includes(type)) {
      const erreur = lireVisuel(type, corps, section);
      if (erreur) return { sections: [], erreur: `Section ${i + 1} : ${erreur}` };
    } else if (type === 'probleme') {
      // « Conseil : … » sur une ligne isolée sépare le problème de son conseil.
      const m = corps.match(/^([\s\S]*?)\n\s*conseil\s*:\s*([\s\S]+)$/i);
      const avant = nettoyer(m ? m[1] : corps);
      const apres = m ? nettoyer(m[2]) : '';
      if (!avant) return { sections: [], erreur: `Section ${i + 1} : décrivez le problème.` };
      if (avant.length > SECTION_MAX.texte) return { sections: [], erreur: `Section ${i + 1} : texte trop long (${SECTION_MAX.texte} caractères maximum).` };
      if (apres.length > SECTION_MAX.conseil) return { sections: [], erreur: `Section ${i + 1} : conseil trop long (${SECTION_MAX.conseil} caractères maximum).` };
      if (!section.titre) return { sections: [], erreur: `Section ${i + 1} : un problème doit porter un titre (« probleme: Problème 1 : … »).` };
      section.texte = avant;
      if (apres) section.conseil = apres;
    } else {
      const corpsPropre = nettoyer(corps);
      if (!corpsPropre) return { sections: [], erreur: `Section ${i + 1} : écrivez le texte de la section.` };
      if (corpsPropre.length > SECTION_MAX.texte) return { sections: [], erreur: `Section ${i + 1} : texte trop long (${SECTION_MAX.texte} caractères maximum).` };
      section.texte = corpsPropre;
    }
    sections.push(section);
  }
  return { sections, erreur: null };
}

/** Rend des sections sous la forme attendue par `lireSections` (pour le formulaire). */
export function ecrireSections(sections) {
  return (sections ?? []).map((s) => {
    const entete = s.titre ? `${s.type}: ${s.titre}` : s.type;
    if (s.type === 'liste') return `${entete}\n${(s.elements ?? []).map((e) => `- ${e}`).join('\n')}`;
    if (TYPES_GRAPHIQUE.includes(s.type)) {
      const lignes = (s.elements ?? []).map((e) => `- ${e.libelle} | ${String(e.valeur).replace('.', ',')}`);
      if (s.unite) lignes.unshift(`unite : ${s.unite}`);
      if (s.max != null) lignes.unshift(`max : ${String(s.max).replace('.', ',')}`);
      if (s.repere) lignes.unshift(`repere : ${String(s.repere.valeur).replace('.', ',')}${s.repere.libelle ? ` | ${s.repere.libelle}` : ''}`);
      if (s.note) lignes.push(`note : ${s.note}`);
      return `${entete}\n${lignes.join('\n')}`;
    }
    if (s.type === 'probleme') return `${entete}\n${s.texte}${s.conseil ? `\nConseil : ${s.conseil}` : ''}`;
    return `${entete}\n${s.texte ?? ''}`;
  }).join('\n---\n');
}

/**
 * Valide une fiche conseil saisie.
 * @param {Record<string, unknown>} corps Corps de requête.
 * @param {{creation: boolean, slugActuel?: string, slugsExistants?: Set<string>}} ctx
 * @returns {{valeurs: Record<string,string>, erreurs: Record<string,string>, fiche: Object|null, version: number|null}}
 */
export function validerConseil(corps, { creation, slugActuel, slugsExistants = new Set() }) {
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
      valeurs[cle] = cle === 'sections' ? brut.replace(/\r\n?/g, '\n') : ligne(brut);
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

  for (const [cle, max] of Object.entries(LONGUEURS)) {
    if (valeurs[cle] && [...valeurs[cle]].length > max) erreurs[cle] ??= `${LIBELLES[cle]} ne doit pas dépasser ${max} caractères.`;
  }
  if (!valeurs.titre) erreurs.titre ??= 'Le titre est obligatoire.';
  if (!valeurs.resume) erreurs.resume ??= 'Le résumé est obligatoire : il s’affiche sur la liste des fiches.';
  if (!Object.hasOwn(OUTILS, valeurs.outil)) erreurs.outil ??= 'Outil inconnu : laissez « Aucun » si la fiche n’en propose pas.';

  const s = lireSections(valeurs.sections);
  if (s.erreur) erreurs.sections ??= s.erreur;

  // Version : exigée en modification, pour refuser une saisie partie d'une version périmée.
  let version = null;
  if (!creation) {
    const brut = typeof source._version === 'string' ? source._version.trim() : '';
    if (!/^\d{1,9}$/.test(brut)) erreurs._version ??= 'Version de la fiche manquante ou invalide : rechargez la page.';
    else version = Number(brut);
  }

  if (Object.keys(erreurs).length) return { valeurs, erreurs, fiche: null, version };

  const fiche = {
    slug: creation ? valeurs.slug : slugActuel,
    titre: valeurs.titre,
    resume: valeurs.resume,
    icone: valeurs.icone,
    outil: valeurs.outil,
    sections: s.sections,
  };
  return { valeurs, erreurs, fiche, version };
}
