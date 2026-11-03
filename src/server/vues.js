/**
 * Compteur de consultations des fiches animaux.
 * Compte en mémoire, écrit sur disque de façon groupée (au plus une écriture
 * toutes les `flushMs`) pour ne pas écrire un fichier à chaque requête.
 * Deux collections : `vues` ({slug: n}) et `vues-jours` ({"AAAA-MM-JJ": n}, 31 jours
 * calendaires conservés, jour calculé en Europe/Paris à l'incrément). Ni cookie ni IP.
 * @module server/vues
 */

const COLLECTION = 'vues';
const COLLECTION_JOURS = 'vues-jours';
/** Nombre de jours calendaires conservés (aujourd'hui inclus). */
export const JOURS_CONSERVES = 31;
const FORMAT_JOUR = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
const RE_JOUR = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Clé « AAAA-MM-JJ » du jour à Paris pour un instant donné (Date, ms ou ISO). */
export function jourParis(instant) {
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) throw new Error('Date invalide.');
  return FORMAT_JOUR.format(d);
}

/** Clé de jour valide (format ET date calendaire existante) ? */
export function cleJourValide(cle) {
  const m = typeof cle === 'string' ? RE_JOUR.exec(cle) : null;
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toISOString().slice(0, 10) === cle;
}

/** Décale une clé de jour de `delta` jours calendaires (arithmétique UTC : insensible aux changements d'heure). */
export function decalerJour(cle, delta) {
  const m = RE_JOUR.exec(cle);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + delta)).toISOString().slice(0, 10);
}

const estObjet = (v) => v && typeof v === 'object' && !Array.isArray(v);

/**
 * @param {{store: {read: Function, update: Function}, flushMs?: number, logger?: {error: Function}, now?: () => (number|Date)}} deps
 * @returns {{charger: Function, incrementer: Function, tous: Function, totauxSur: Function, flush: Function, stop: Function}}
 */
export function createCompteurVues({ store, flushMs = 5000, logger = console, now = () => Date.now() } = {}) {
  if (!store) throw new Error('createCompteurVues : store est requis.');
  /** @type {Map<string, number>} */
  const total = new Map();
  /** @type {Map<string, number>} */
  const enAttente = new Map();
  /** Compteurs par jour (mémoire = disque + en attente). @type {Map<string, number>} */
  const jours = new Map();
  /** Lot en attente propre à `vues-jours`. @type {Map<string, number>} */
  const joursEnAttente = new Map();
  let minuterie = null;

  const aujourdhui = () => jourParis(now());
  const limiteBasse = (jour) => decalerJour(jour, -(JOURS_CONSERVES - 1));

  function elaguerMemoire() {
    const bas = limiteBasse(aujourdhui());
    for (const cle of [...jours.keys()]) if (!cleJourValide(cle) || cle < bas) jours.delete(cle);
  }

  async function flushVues() {
    if (enAttente.size === 0) return;
    const lot = new Map(enAttente);
    enAttente.clear();
    try {
      const data = await store.update(COLLECTION, (brut) => {
        const out = estObjet(brut) ? { ...brut } : {};
        for (const [slug, n] of lot) out[slug] = (Number(out[slug]) || 0) + n;
        return out;
      }, {});
      for (const [slug, n] of Object.entries(data)) total.set(slug, Number(n) || 0);
    } catch (e) {
      for (const [slug, n] of lot) enAttente.set(slug, (enAttente.get(slug) ?? 0) + n); // réessai au prochain tour
      logger.error?.(`[vues] écriture impossible : ${e?.message ?? e}`);
    }
  }

  async function flushJours() {
    if (joursEnAttente.size === 0) return;
    const lot = new Map(joursEnAttente);
    joursEnAttente.clear();
    try {
      const bas = limiteBasse(aujourdhui());
      await store.update(COLLECTION_JOURS, (brut) => {
        const out = {};
        if (estObjet(brut)) {
          for (const [cle, n] of Object.entries(brut)) if (cleJourValide(cle) && cle >= bas) out[cle] = Number(n) || 0;
        }
        for (const [cle, n] of lot) if (cle >= bas) out[cle] = (out[cle] ?? 0) + n;
        return out;
      }, {});
    } catch (e) {
      for (const [cle, n] of lot) joursEnAttente.set(cle, (joursEnAttente.get(cle) ?? 0) + n);
      logger.error?.(`[vues] écriture des jours impossible : ${e?.message ?? e}`);
    }
  }

  // Chaque collection a son propre lot : l'échec de l'une ne rejoue jamais l'autre.
  async function flush() {
    await flushVues();
    await flushJours();
  }

  return {
    /** Charge les compteurs persistés (totaux et jours). */
    async charger() {
      const brut = await store.read(COLLECTION, {});
      total.clear();
      if (estObjet(brut)) {
        for (const [slug, n] of Object.entries(brut)) total.set(slug, Number(n) || 0);
      }
      const brutJours = await store.read(COLLECTION_JOURS, {});
      jours.clear();
      if (estObjet(brutJours)) {
        for (const [cle, n] of Object.entries(brutJours)) if (cleJourValide(cle)) jours.set(cle, Number(n) || 0);
      }
      elaguerMemoire();
      return this.tous();
    },
    /** Ajoute une consultation (écriture disque différée). Le jour est figé ici, à l'heure de Paris. */
    incrementer(slug) {
      if (typeof slug !== 'string' || !slug) return;
      total.set(slug, (total.get(slug) ?? 0) + 1);
      enAttente.set(slug, (enAttente.get(slug) ?? 0) + 1);
      const jour = aujourdhui();
      jours.set(jour, (jours.get(jour) ?? 0) + 1);
      joursEnAttente.set(jour, (joursEnAttente.get(jour) ?? 0) + 1);
      elaguerMemoire();
      if (!minuterie) {
        minuterie = setTimeout(() => { minuterie = null; flush(); }, flushMs);
        minuterie.unref?.();
      }
    },
    /** Instantané `{slug: consultations}`. */
    tous() {
      return Object.fromEntries(total);
    },
    /**
     * Total des consultations sur `n` jours calendaires (Paris), aujourd'hui inclus
     * (7 = J à J-6), y compris ce qui n'est pas encore écrit.
     */
    totauxSur(n) {
      const nb = Math.max(0, Math.floor(Number(n) || 0));
      const fin = aujourdhui();
      let somme = 0;
      for (let i = 0; i < nb; i += 1) somme += jours.get(decalerJour(fin, -i)) ?? 0;
      return somme;
    },
    flush,
    /** Arrête la minuterie et écrit ce qui reste. */
    async stop() {
      if (minuterie) clearTimeout(minuterie);
      minuterie = null;
      await flush();
    },
  };
}
