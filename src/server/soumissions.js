/**
 * Soumissions des formulaires publics : enregistrement, lecture pour l'espace
 * interne et purge automatique au-delà de la durée de conservation (12 mois).
 * Aucune IP n'est enregistrée : seules les valeurs saisies et la date.
 * @module server/soumissions
 */
import { randomUUID } from 'node:crypto';
import { FORM_SCHEMAS } from '../security/validation.js';
import { purgeOldSubmissions, RETENTION_MONTHS } from '../security/purge.js';

/** Types de formulaires, dans l'ordre d'affichage de l'espace interne. */
export const TYPES = Object.freeze(['interet', 'contact', 'benevolat', 'don_parrainage']);

const LIBELLES = Object.freeze({
  interet: 'Demandes d’intérêt',
  contact: 'Messages de contact',
  benevolat: 'Propositions de bénévolat',
  don_parrainage: 'Dons et parrainages',
});

/** Libellé humain d'un type de formulaire. */
export const libelleType = (type) => LIBELLES[type] ?? type;

/**
 * Colonnes d'un type de formulaire, déduites du schéma de validation et
 * étiquetées avec les libellés du contenu éditorial.
 * @param {string} type Type de formulaire.
 * @param {Record<string, any>} formulaires Contenu de `content/formulaires.json`.
 * @returns {Array<{cle: string, libelle: string}>} Colonnes.
 */
export function colonnesDe(type, formulaires) {
  const schema = FORM_SCHEMAS[type] ?? {};
  const champs = formulaires?.[type]?.champs ?? {};
  const colonnes = Object.keys(schema).map((cle) => ({
    cle,
    libelle: String(champs[cle]?.label ?? cle).replace(/\s*\(facultatif\)\s*$/i, ''),
  }));
  if (type === 'interet') colonnes.unshift({ cle: 'animal', libelle: 'Animal concerné' });
  return colonnes;
}

/**
 * Crée le dépôt des soumissions au-dessus d'un magasin JSON.
 * @param {{store: {read: Function, update: Function}, now?: () => number, months?: number}} deps
 * @returns {{ajouter: Function, lister: Function, compter: Function, purger: Function}} Dépôt.
 */
export function createSoumissions({ store, now = Date.now, months = RETENTION_MONTHS } = {}) {
  if (!store) throw new Error('createSoumissions : store est requis.');
  const COLLECTION = 'soumissions';
  const vide = () => Object.fromEntries(TYPES.map((t) => [t, []]));

  const normaliser = (brut) => {
    const base = vide();
    for (const t of TYPES) if (Array.isArray(brut?.[t])) base[t] = brut[t];
    return base;
  };

  /** Supprime les soumissions au-delà de la durée de conservation. */
  async function purger() {
    let purgees = 0;
    await store.update(COLLECTION, (brut) => {
      const data = normaliser(brut);
      for (const t of TYPES) {
        const { kept, purged } = purgeOldSubmissions(data[t], { now: now(), months });
        purgees += purged.length;
        data[t] = kept;
      }
      return data;
    }, vide());
    return purgees;
  }

  return {
    purger,
    /**
     * Enregistre une soumission validée.
     * @param {string} type Type de formulaire.
     * @param {Record<string, string>} valeurs Valeurs déjà validées et assainies.
     * @returns {Promise<{id: string, createdAt: string}>} Identifiant et date.
     */
    async ajouter(type, valeurs) {
      if (!TYPES.includes(type)) throw new Error(`Type de formulaire inconnu : ${String(type)}`);
      const entree = { id: randomUUID(), createdAt: new Date(now()).toISOString(), valeurs: { ...valeurs } };
      await store.update(COLLECTION, (brut) => {
        const data = normaliser(brut);
        data[type] = [...data[type], entree];
        return data;
      }, vide());
      return { id: entree.id, createdAt: entree.createdAt };
    },
    /** Soumissions d'un type, de la plus récente à la plus ancienne. */
    async lister(type) {
      const data = normaliser(await store.read(COLLECTION, vide()));
      return [...(data[type] ?? [])].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    },
    /** Nombre de soumissions par type. */
    async compter() {
      const data = normaliser(await store.read(COLLECTION, vide()));
      return Object.fromEntries(TYPES.map((t) => [t, data[t].length]));
    },
  };
}
