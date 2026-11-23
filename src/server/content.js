/**
 * Chargement du contenu éditorial (dossier `content/`) et index dérivés.
 * Pages et formulaires sont lus une fois (figés). Fiches animaux, fiches conseils
 * et contenu « nous soutenir » sont rechargés à chaud après chaque écriture
 * (écriture atomique via le store, puis reconstruction des index).
 * Dossier de contenu : option `dir`, sinon variable CONTENT_DIR, sinon `content/`.
 * @module server/content
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Libellés d'affichage des espèces. */
export const LIBELLES_ESPECE = Object.freeze({
  chien: 'Chien', chat: 'Chat', lapin: 'Lapin', rongeur: 'Rongeur', oiseau: 'Oiseau', nac: 'NAC',
});
/** Libellés d'affichage des tranches d'âge. */
export const LIBELLES_TRANCHE = Object.freeze({ jeune: 'Jeune', adulte: 'Adulte', senior: 'Senior' });
/** Libellés d'affichage des tailles. */
export const LIBELLES_TAILLE = Object.freeze({ petit: 'Petit', moyen: 'Moyen', grand: 'Grand' });

const ORDRE = { espece: ['chat', 'chien', 'lapin', 'rongeur', 'oiseau', 'nac'], tranche: ['jeune', 'adulte', 'senior'], taille: ['petit', 'moyen', 'grand'] };
/** Types de sections acceptés dans une fiche conseil (pilote le rendu). */
export const TYPES_SECTION = Object.freeze(['texte', 'liste', 'conseil', 'saviez_vous', 'probleme', 'chiffres', 'barres', 'anneau']);
/** Types de sections rendus sous forme de visuel (chiffres clés ou graphique). */
export const TYPES_GRAPHIQUE = Object.freeze(['chiffres', 'barres', 'anneau']);

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
 * @property {Array<Object>} disponibles Fiches au statut `disponible` (atelier réseaux, sitemap).
 * @property {Array<Object>} visibles Fiches au statut `disponible` ou `en_soins` (catalogue public).
 * @property {Array<Object>} conseils Fiches conseils (`content/conseils.json`).
 * @property {(slug: string) => Object | undefined} conseil Fiche conseil par slug.
 * @property {Object} soutien Contenu « nous soutenir » (`content/soutien.json`).
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

  for (const cle of ['accueil', 'animaux', 'nos_missions', 'famille_accueil', 'soutenir', 'conseils', 'contact', 'mentions_legales', 'confidentialite']) {
    if (!pages?.[cle]?.title) throw new Error(`content/pages.json : page « ${cle} » absente ou incomplète.`);
  }
  if (!pages?.association?.nom) throw new Error('content/pages.json : bloc « association » absent ou incomplet.');
  for (const cle of ['interet', 'contact', 'benevolat', 'famille_accueil', 'adhesion', 'don_parrainage']) {
    if (!formulaires?.[cle]?.champs) throw new Error(`content/formulaires.json : formulaire « ${cle} » absent ou incomplet.`);
  }

  let etat = construire(lire('animaux.json', dossier));
  let etatConseils = construireConseils(lire('conseils.json', dossier));
  let soutien = verifierSoutien(lire('soutien.json', dossier));
  const store = createStore({ dir: dossier });

  return Object.freeze({
    pages: Object.freeze(pages),
    formulaires: Object.freeze(formulaires),
    get animaux() { return etat.animaux; },
    get disponibles() { return etat.disponibles; },
    get visibles() { return etat.visibles; },
    get options() { return etat.options; },
    animal: (slug) => etat.animal(slug),
    get conseils() { return etatConseils.conseils; },
    conseil: (slug) => etatConseils.conseil(slug),
    get soutien() { return soutien; },
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
    /**
     * Même contrat que `modifierAnimaux`, pour `conseils.json`.
     * @param {(liste: Array<Object>) => Array<Object>} fn
     * @returns {Promise<Array<Object>>} Nouvelle liste.
     */
    async modifierConseils(fn) {
      const suivant = await store.update('conseils', (liste) => {
        const n = fn(structuredClone(liste));
        construireConseils(n);
        return n;
      }, []);
      etatConseils = construireConseils(suivant);
      return suivant;
    },
    /**
     * Même contrat, pour `soutien.json` (objet et non liste).
     * @param {(contenu: Object) => Object} fn
     * @returns {Promise<Object>} Nouveau contenu.
     */
    async modifierSoutien(fn) {
      const suivant = await store.update('soutien', (courant) => {
        const n = fn(structuredClone(courant));
        verifierSoutien(n);
        return n;
      }, {});
      soutien = verifierSoutien(suivant);
      return soutien;
    },
  });
}

/** Valide et fige les fiches conseils ; renvoie les index dérivés. */
function construireConseils(brut) {
  if (!Array.isArray(brut)) throw new Error('content/conseils.json : un tableau de fiches est attendu.');
  const vus = new Set();
  const conseils = brut.map((c) => {
    if (!c?.slug || !/^[a-z0-9-]+$/.test(c.slug)) throw new Error(`content/conseils.json : slug invalide (${JSON.stringify(c?.slug)}).`);
    if (vus.has(c.slug)) throw new Error(`content/conseils.json : slug en doublon (${c.slug}).`);
    vus.add(c.slug);
    if (!c.titre) throw new Error(`content/conseils.json : titre manquant (${c.slug}).`);
    if (!Array.isArray(c.sections)) throw new Error(`content/conseils.json : sections manquantes (${c.slug}).`);
    for (const s of c.sections) {
      if (!TYPES_SECTION.includes(s?.type)) {
        throw new Error(`content/conseils.json : type de section inconnu « ${String(s?.type)} » dans ${c.slug} (attendu : ${TYPES_SECTION.join(', ')}).`);
      }
      // Les visuels sont calculés au rendu : on refuse ici une section sans
      // données plutôt que de laisser échouer le gabarit en production.
      if (TYPES_GRAPHIQUE.includes(s.type)) {
        const ok = Array.isArray(s.elements) && s.elements.length
          && s.elements.every((e) => e && typeof e.libelle === 'string' && e.libelle
            && (s.type === 'chiffres' ? typeof e.valeur === 'string' && e.valeur : Number.isFinite(e.valeur) && e.valeur >= 0));
        if (!ok) throw new Error(`content/conseils.json : section « ${s.type} » sans données exploitables dans ${c.slug} (attendu : elements[{ libelle, valeur }]).`);
      }
    }
    return Object.freeze({ ...c, sections: Object.freeze(c.sections.map((s) => Object.freeze({ ...s }))) });
  });
  const parSlug = new Map(conseils.map((c) => [c.slug, c]));
  return { conseils: Object.freeze(conseils), conseil: (slug) => parSlug.get(String(slug)) };
}

/** Vérifie la forme de `soutien.json` et le fige. */
function verifierSoutien(brut) {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) throw new Error('content/soutien.json : un objet est attendu.');
  if (!brut.paiement || typeof brut.paiement !== 'object') throw new Error('content/soutien.json : bloc « paiement » absent.');
  for (const cle of ['besoins', 'collectes']) {
    if (!Array.isArray(brut[cle])) throw new Error(`content/soutien.json : « ${cle} » doit être un tableau.`);
  }
  return Object.freeze({
    ...brut,
    paiement: Object.freeze({ ...brut.paiement }),
    besoins: Object.freeze(brut.besoins.map((b) => Object.freeze({ ...b }))),
    collectes: Object.freeze(brut.collectes.map((c) => Object.freeze({ ...c }))),
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
  // Catalogue public : un animal « en soins » est montré, avec son badge ;
  // seuls les animaux adoptés disparaissent du site.
  const visibles = Object.freeze(animaux.filter((a) => a.statut === 'disponible' || a.statut === 'en_soins'));
  return {
    animaux: Object.freeze(animaux),
    disponibles,
    visibles,
    animal: (slug) => parSlug.get(String(slug)),
    options: Object.freeze({
      especes: options(visibles, 'espece'),
      tranches: options(visibles, 'tranche'),
      tailles: options(visibles, 'taille'),
    }),
  };
}
