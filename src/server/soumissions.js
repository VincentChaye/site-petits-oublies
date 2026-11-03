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

/** Statuts de suivi d'une demande (exactement ces trois valeurs). */
export const STATUTS = Object.freeze(['nouvelle', 'en_cours', 'traitee']);
export const LIBELLES_STATUT = Object.freeze({ nouvelle: 'Nouvelle', en_cours: 'En cours', traitee: 'Traitée' });
/** Longueur maximale de la note, en points de code. */
export const NOTE_MAX = 2000;

/** Statut valide ? */
export const statutValide = (v) => typeof v === 'string' && STATUTS.includes(v);

/**
 * Valide et assainit une note de suivi.
 * @param {unknown} brut Valeur saisie.
 * @returns {{ok: true, note: string} | {ok: false, message: string}} Résultat.
 */
export function validerNote(brut) {
  if (brut === undefined || brut === null) return { ok: true, note: '' };
  if (typeof brut !== 'string') return { ok: false, message: 'La note doit être un texte.' };
  const note = brut.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if ([...note].length > NOTE_MAX) return { ok: false, message: `La note est trop longue (${NOTE_MAX} caractères maximum).` };
  return { ok: true, note };
}

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

  /** Valeurs par défaut du suivi pour une entrée ancienne (lecture seule). */
  const suivi = (s) => ({
    ...s,
    statut: statutValide(s.statut) ? s.statut : 'nouvelle',
    note: typeof s.note === 'string' ? s.note : '',
    modifieLe: s.modifieLe ?? s.createdAt,
  });

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
      const entree = { id: randomUUID(), createdAt: new Date(now()).toISOString(), valeurs: { ...valeurs }, statut: 'nouvelle', note: '' };
      entree.modifieLe = entree.createdAt;
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
      return (data[type] ?? []).map(suivi).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    },
    /**
     * Met à jour statut et/ou note d'une soumission (atomique via store.update).
     * Les valeurs doivent déjà être validées (statutValide, validerNote).
     * @returns {Promise<{type: string, soumission: any} | null>} null si introuvable.
     */
    async modifier(id, { statut, note }) {
      let trouve = null;
      await store.update(COLLECTION, (brut) => {
        trouve = null;
        const data = normaliser(brut);
        for (const t of TYPES) {
          const i = data[t].findIndex((s) => s?.id === id);
          if (i < 0) continue;
          const maj = suivi(data[t][i]);
          if (statut !== undefined) maj.statut = statut;
          if (note !== undefined) maj.note = note;
          maj.modifieLe = new Date(now()).toISOString();
          data[t] = data[t].map((s, j) => (j === i ? maj : s));
          trouve = { type: t, soumission: maj };
        }
        return data;
      }, vide());
      return trouve;
    },
    /**
     * Migration idempotente : statut 'nouvelle' et note vide aux anciennes
     * soumissions (statut valide conservé) ; pour « interet », déduit animalSlug
     * quand valeurs.animal correspond au nom d'UNE SEULE fiche.
     * @param {{animaux?: Array<{slug: string, nom: string}>}} [opts]
     * @returns {Promise<{suivi: number, animalSlug: number}>} Nombre d'entrées modifiées.
     */
    async migrer({ animaux = [] } = {}) {
      const parNom = new Map();
      for (const a of animaux) parNom.set(a.nom, [...(parNom.get(a.nom) ?? []), a.slug]);
      const bilan = { suivi: 0, animalSlug: 0 };
      await store.update(COLLECTION, (brut) => {
        bilan.suivi = 0;
        bilan.animalSlug = 0;
        const data = normaliser(brut);
        for (const t of TYPES) {
          data[t] = data[t].map((s) => {
            let m = s;
            if (!statutValide(s.statut) || typeof s.note !== 'string') {
              m = { ...m, statut: statutValide(s.statut) ? s.statut : 'nouvelle', note: typeof s.note === 'string' ? s.note : '' };
              if (m.modifieLe === undefined) m.modifieLe = s.createdAt;
              bilan.suivi += 1;
            }
            if (t === 'interet' && m.valeurs && !m.valeurs.animalSlug && typeof m.valeurs.animal === 'string') {
              const slugs = parNom.get(m.valeurs.animal) ?? [];
              if (slugs.length === 1) {
                m = { ...m, valeurs: { ...m.valeurs, animalSlug: slugs[0] } };
                bilan.animalSlug += 1;
              }
            }
            return m;
          });
        }
        return data;
      }, vide());
      return bilan;
    },
    /** Nombre de soumissions par type. */
    async compter() {
      const data = normaliser(await store.read(COLLECTION, vide()));
      return Object.fromEntries(TYPES.map((t) => [t, data[t].length]));
    },
  };
}
