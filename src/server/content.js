/**
 * Chargement du contenu éditorial (dossier `content/`) et index dérivés.
 * Pages et formulaires sont lus une fois (figés). Les fiches animaux sont
 * rechargées à chaud après chaque écriture (`animaux.json`, atomique via le store).
 * Dossier de contenu : option `dir`, sinon variable CONTENT_DIR, sinon `content/`.
 * @module server/content
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Libellés d'affichage des espèces. */
export const LIBELLES_ESPECE = Object.freeze({ chien: 'Chien', chat: 'Chat', lapin: 'Lapin' });
/** Libellés d'affichage des tranches d'âge. */
export const LIBELLES_TRANCHE = Object.freeze({ jeune: 'Jeune', adulte: 'Adulte', senior: 'Senior' });
/** Libellés d'affichage des tailles. */
export const LIBELLES_TAILLE = Object.freeze({ petit: 'Petit', moyen: 'Moyen', grand: 'Grand' });

const ORDRE = { espece: ['chien', 'chat', 'lapin'], tranche: ['jeune', 'adulte', 'senior'], taille: ['petit', 'moyen', 'grand'] };
const LIBELLES = { espece: LIBELLES_ESPECE, tranche: LIBELLES_TRANCHE, taille: LIBELLES_TAILLE };

function lire(fichier, dossier) {
  const chemin = path.join(dossier, fichier);
  let brut;
  try {
    brut = readFileSync(chemin, 'utf8');
  } catch (e) {
    throw new Error(`Contenu introuvable : ${chemin} (${e.code ?? e.message}).`);
  }
  try {
    return JSON.parse(brut);
  } catch (e) {
    throw new Error(`Contenu illisible (JSON invalide) : ${chemin} — ${e.message}`);
  }
}

/** Construit la liste d'options d'un filtre, dans l'ordre métier et sans valeur absente. */
function options(animaux, champ) {
  const presentes = new Set(animaux.map((a) => a[champ]).filter(Boolean));
  const ordre = ORDRE[champ].filter((v) => presentes.has(v));
  for (const v of presentes) if (!ordre.includes(v)) ordre.push(v);
  return Object.freeze(ordre.map((valeur) => Object.freeze({ valeur, libelle: LIBELLES[champ][valeur] ?? valeur })));
}

/**
 * @typedef {Object} Contenu
 * @property {Record<string, any>} pages Pages éditoriales (`content/pages.json`).
 * @property {Record<string, any>} formulaires Libellés des formulaires (`content/formulaires.json`).
 * @property {Array<Object>} animaux Toutes les fiches, ordre du fichier.
 * @property {Array<Object>} disponibles Fiches au statut `disponible`.
 * @property {(slug: string) => Object | undefined} animal Fiche par slug.
 * @property {{especes: Array, tranches: Array, tailles: Array}} options Options des filtres.
 */

/**
 * Charge et vérifie le contenu éditorial.
 * @returns {Readonly<Contenu>} Contenu figé.
 * @throws {Error} Si un fichier est absent, illisible ou incomplet.
 */
export function chargerContenu({ dir = process.env.CONTENT_DIR || path.join(RACINE, 'content') } = {}) {
  const dossier = path.resolve(dir);
  const pages = lire('pages.json', dossier);
  const formulaires = lire('formulaires.json', dossier);

  for (const cle of ['accueil', 'animaux', 'refuge', 'contact', 'mentions_legales', 'confidentialite']) {
    if (!pages?.[cle]?.title) throw new Error(`content/pages.json : page « ${cle} » absente ou incomplète.`);
  }
  for (const cle of ['interet', 'contact', 'benevolat', 'don_parrainage']) {
    if (!formulaires?.[cle]?.champs) throw new Error(`content/formulaires.json : formulaire « ${cle} » absent ou incomplet.`);
  }

  let etat = construire(lire('animaux.json', dossier));
  const store = createStore({ dir: dossier });

  return Object.freeze({
    pages: Object.freeze(pages),
    formulaires: Object.freeze(formulaires),
    get animaux() { return etat.animaux; },
    get disponibles() { return etat.disponibles; },
    get options() { return etat.options; },
    animal: (slug) => etat.animal(slug),
    dossier,
    /**
     * Lecture-modification-écriture atomique et sérialisée de `animaux.json`, puis
     * rechargement à chaud. `fn(liste)` renvoie la nouvelle liste ; si elle lève, rien n'est écrit.
     * @param {(liste: Array<Object>) => Array<Object>} fn
     * @returns {Promise<Array<Object>>} Nouvelle liste.
     */
    async modifierAnimaux(fn) {
      const suivant = await store.update('animaux', (liste) => {
        const n = fn(structuredClone(liste));
        construire(n); // n'écrit jamais un fichier que le chargement rejetterait
        return n;
      });
      etat = construire(suivant);
      return suivant;
    },
  });
}

/** Valide et fige les fiches ; renvoie les index dérivés. */
function construire(brutAnimaux) {
  if (!Array.isArray(brutAnimaux) || brutAnimaux.length === 0) {
    throw new Error('content/animaux.json : un tableau non vide de fiches est attendu.');
  }
  const vus = new Set();
  const animaux = brutAnimaux.map((a) => {
    if (!a?.slug || !/^[a-z0-9-]+$/.test(a.slug)) throw new Error(`content/animaux.json : slug invalide (${JSON.stringify(a?.slug)}).`);
    if (vus.has(a.slug)) throw new Error(`content/animaux.json : slug en doublon (${a.slug}).`);
    vus.add(a.slug);
    return Object.freeze({ ...a, photos: Object.freeze((a.photos ?? []).map((p) => Object.freeze({ ...p }))) });
  });
  const parSlug = new Map(animaux.map((a) => [a.slug, a]));
  const disponibles = Object.freeze(animaux.filter((a) => a.statut === 'disponible'));
  return {
    animaux: Object.freeze(animaux),
    disponibles,
    animal: (slug) => parSlug.get(String(slug)),
    options: Object.freeze({
      especes: options(disponibles, 'espece'),
      tranches: options(disponibles, 'tranche'),
      tailles: options(disponibles, 'taille'),
    }),
  };
}
