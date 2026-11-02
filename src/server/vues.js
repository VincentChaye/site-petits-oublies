/**
 * Compteur de consultations des fiches animaux.
 * Compte en mémoire, écrit sur disque de façon groupée (au plus une écriture
 * toutes les `flushMs`) pour ne pas écrire un fichier à chaque requête.
 * @module server/vues
 */

/**
 * @param {{store: {read: Function, update: Function}, flushMs?: number, logger?: {error: Function}}} deps
 * @returns {{charger: Function, incrementer: Function, tous: Function, flush: Function, stop: Function}}
 */
export function createCompteurVues({ store, flushMs = 5000, logger = console } = {}) {
  if (!store) throw new Error('createCompteurVues : store est requis.');
  const COLLECTION = 'vues';
  /** @type {Map<string, number>} */
  const total = new Map();
  /** @type {Map<string, number>} */
  const enAttente = new Map();
  let minuterie = null;

  async function flush() {
    if (enAttente.size === 0) return;
    const lot = new Map(enAttente);
    enAttente.clear();
    try {
      const data = await store.update(COLLECTION, (brut) => {
        const out = brut && typeof brut === 'object' && !Array.isArray(brut) ? { ...brut } : {};
        for (const [slug, n] of lot) out[slug] = (Number(out[slug]) || 0) + n;
        return out;
      }, {});
      for (const [slug, n] of Object.entries(data)) total.set(slug, Number(n) || 0);
    } catch (e) {
      for (const [slug, n] of lot) enAttente.set(slug, (enAttente.get(slug) ?? 0) + n); // réessai au prochain tour
      logger.error?.(`[vues] écriture impossible : ${e?.message ?? e}`);
    }
  }

  return {
    /** Charge les compteurs persistés. */
    async charger() {
      const brut = await store.read(COLLECTION, {});
      total.clear();
      if (brut && typeof brut === 'object' && !Array.isArray(brut)) {
        for (const [slug, n] of Object.entries(brut)) total.set(slug, Number(n) || 0);
      }
      return this.tous();
    },
    /** Ajoute une consultation (écriture disque différée). */
    incrementer(slug) {
      if (typeof slug !== 'string' || !slug) return;
      total.set(slug, (total.get(slug) ?? 0) + 1);
      enAttente.set(slug, (enAttente.get(slug) ?? 0) + 1);
      if (!minuterie) {
        minuterie = setTimeout(() => { minuterie = null; flush(); }, flushMs);
        minuterie.unref?.();
      }
    },
    /** Instantané `{slug: consultations}`. */
    tous() {
      return Object.fromEntries(total);
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
