/**
 * Validation des fiches conseils saisies depuis /interne.
 * Même moule que `animaux-validation.js` : liste blanche stricte des champs,
 * construction de la fiche par littéral (jamais de recopie générique de la
 * saisie), rejet de __proto__ / constructor / prototype. Aucun HTML n'est
 * accepté : le texte est échappé à l'affichage, comme partout ailleurs.
 * @module server/conseils-validation
 */
import { TYPES_SECTION } from './content.js';

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

/** Libellés des types de section, pour le formulaire interne. */
export const LIBELLES_TYPE = Object.freeze({
  texte: 'Paragraphe', liste: 'Liste à puces', conseil: 'Encadré « conseil »',
  saviez_vous: 'Encadré « le saviez-vous ? »', probleme: 'Problème + conseil',
});

/** Texte libre d'une section : contrôles supprimés, sauts de ligne conservés. */
const nettoyer = (v) => (typeof v === 'string' ? v.normalize('NFC').replace(/\r\n?/g, '\n').replace(/(?!\n)[\p{Cc}\p{Zl}\p{Zp}]/gu, '').trim() : '');
/** Texte d'une seule ligne. */
const ligne = (v) => (typeof v === 'string' ? v.normalize('NFC').replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ').replace(/ {2,}/g, ' ').trim() : '');

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
