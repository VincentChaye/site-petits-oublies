/**
 * Besoins en matériel et agenda des collectes depuis /interne/soutien.
 * Calqué sur `interne-animaux.js` : à monter APRÈS la garde de session et le
 * CSRF, écriture atomique via `contenu.modifierSoutien`, champ `_version` et
 * refus 409 d'une version périmée.
 * @module server/routes/interne-soutien
 */
import { validerBesoin, validerCollecte, MAX_ENTREES } from '../soutien-validation.js';

const MESSAGES = Object.freeze({
  besoin_ajoute: { type: 'succes', texte: 'Besoin ajouté : il est visible sur « Nous soutenir ».' },
  besoin_supprime: { type: 'succes', texte: 'Besoin supprimé.' },
  collecte_ajoutee: { type: 'succes', texte: 'Collecte ajoutée : elle s’affichera jusqu’à sa date, puis disparaîtra d’elle-même.' },
  collecte_supprimee: { type: 'succes', texte: 'Collecte supprimée.' },
});

/** Erreur métier portant un code HTTP. */
class ErreurSoutien extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const versionDe = (c) => (Number.isInteger(c?._version) && c._version >= 0 ? c._version : 0);
const MSG_PERIME = 'Ce contenu a été modifié par quelqu’un d’autre depuis l’ouverture de la page. Rechargez-la pour repartir de la version à jour.';

/**
 * @param {import('express').Router} router
 * @param {{contenu: any, logger?: {error: Function}}} deps
 */
export function monterSoutien(router, { contenu, logger = console }) {
  const aujourdhui = () => new Date().toISOString().slice(0, 10);

  const rendre = (res, { status = 200, message = null, valeursBesoin = {}, erreursBesoin = {}, valeursCollecte = {}, erreursCollecte = {} } = {}) => {
    const s = contenu.soutien;
    const jour = aujourdhui();
    res.status(status).render('interne/soutien', {
      version: versionDe(s),
      paiement: s.paiement,
      besoins: s.besoins,
      collectes: [...s.collectes]
        .sort((a, b) => String(a.date).localeCompare(String(b.date)))
        .map((c) => ({ ...c, passee: String(c.date) < jour })),
      valeursBesoin: { id: '', titre: '', detail: '', ...valeursBesoin },
      erreursBesoin,
      valeursCollecte: { id: '', date: '', lieu: '', ville: '', horaires: '', detail: '', ...valeursCollecte },
      erreursCollecte,
      message,
    });
  };

  /** Version attendue, lue dans le corps : jamais déduite. */
  function versionAttendue(req) {
    const brut = typeof req.body?._version === 'string' ? req.body._version.trim() : '';
    return /^\d{1,9}$/.test(brut) ? Number(brut) : null;
  }

  /** Applique `fn` au contenu soutien, sous contrôle de version. */
  async function appliquer(attendue, fn) {
    await contenu.modifierSoutien((courant) => {
      if (versionDe(courant) !== attendue) throw new ErreurSoutien(409, MSG_PERIME);
      const suivant = fn(courant);
      suivant._version = attendue + 1;
      return suivant;
    });
  }

  // ── Écran ──
  router.get('/soutien', (req, res, next) => {
    try {
      rendre(res, { message: MESSAGES[String(req.query.ok ?? '')] ?? null });
    } catch (e) { next(e); }
  });

  // ── Besoins ──
  router.post('/soutien/besoins', async (req, res, next) => {
    try {
      const attendue = versionAttendue(req);
      const { _version, _csrf, ...champs } = req.body ?? {};
      const v = validerBesoin(champs, { existants: new Set(contenu.soutien.besoins.map((b) => b.id)) });
      if (attendue === null) {
        return rendre(res, { status: 422, valeursBesoin: v.valeurs, message: { type: 'erreur', texte: 'Version manquante ou invalide : rechargez la page.' } });
      }
      if (!v.besoin) return rendre(res, { status: 422, valeursBesoin: v.valeurs, erreursBesoin: v.erreurs });
      if (contenu.soutien.besoins.length >= MAX_ENTREES) {
        return rendre(res, { status: 422, valeursBesoin: v.valeurs, message: { type: 'erreur', texte: `La liste des besoins est pleine (${MAX_ENTREES} entrées au maximum). Supprimez-en avant d’en ajouter.` } });
      }
      try {
        await appliquer(attendue, (c) => ({ ...c, besoins: [...c.besoins, v.besoin] }));
      } catch (e) {
        if (!(e instanceof ErreurSoutien)) throw e;
        return rendre(res, { status: e.status, valeursBesoin: v.valeurs, message: { type: 'erreur', texte: e.message } });
      }
      res.redirect(303, '/interne/soutien?ok=besoin_ajoute#besoins');
    } catch (e) { next(e); }
  });

  router.post('/soutien/besoins/:id/supprimer', async (req, res, next) => {
    try {
      const attendue = versionAttendue(req);
      if (attendue === null) {
        return rendre(res, { status: 422, message: { type: 'erreur', texte: 'Version manquante ou invalide : rechargez la page.' } });
      }
      const id = String(req.params.id ?? '');
      try {
        await appliquer(attendue, (c) => {
          if (!c.besoins.some((b) => b.id === id)) throw new ErreurSoutien(404, 'Besoin introuvable : il a peut-être déjà été supprimé.');
          return { ...c, besoins: c.besoins.filter((b) => b.id !== id) };
        });
      } catch (e) {
        if (!(e instanceof ErreurSoutien)) throw e;
        return rendre(res, { status: e.status, message: { type: 'erreur', texte: e.message } });
      }
      res.redirect(303, '/interne/soutien?ok=besoin_supprime#besoins');
    } catch (e) { next(e); }
  });

  // ── Collectes ──
  router.post('/soutien/collectes', async (req, res, next) => {
    try {
      const attendue = versionAttendue(req);
      const { _version, _csrf, ...champs } = req.body ?? {};
      const v = validerCollecte(champs, { existants: new Set(contenu.soutien.collectes.map((c) => c.id)) });
      if (attendue === null) {
        return rendre(res, { status: 422, valeursCollecte: v.valeurs, message: { type: 'erreur', texte: 'Version manquante ou invalide : rechargez la page.' } });
      }
      if (!v.collecte) return rendre(res, { status: 422, valeursCollecte: v.valeurs, erreursCollecte: v.erreurs });
      if (contenu.soutien.collectes.length >= MAX_ENTREES) {
        return rendre(res, { status: 422, valeursCollecte: v.valeurs, message: { type: 'erreur', texte: `L’agenda est plein (${MAX_ENTREES} entrées au maximum). Supprimez des collectes passées avant d’en ajouter.` } });
      }
      try {
        await appliquer(attendue, (c) => ({ ...c, collectes: [...c.collectes, v.collecte] }));
      } catch (e) {
        if (!(e instanceof ErreurSoutien)) throw e;
        return rendre(res, { status: e.status, valeursCollecte: v.valeurs, message: { type: 'erreur', texte: e.message } });
      }
      res.redirect(303, '/interne/soutien?ok=collecte_ajoutee#collectes');
    } catch (e) { next(e); }
  });

  router.post('/soutien/collectes/:id/supprimer', async (req, res, next) => {
    try {
      const attendue = versionAttendue(req);
      if (attendue === null) {
        return rendre(res, { status: 422, message: { type: 'erreur', texte: 'Version manquante ou invalide : rechargez la page.' } });
      }
      const id = String(req.params.id ?? '');
      try {
        await appliquer(attendue, (c) => {
          if (!c.collectes.some((x) => x.id === id)) throw new ErreurSoutien(404, 'Collecte introuvable : elle a peut-être déjà été supprimée.');
          return { ...c, collectes: c.collectes.filter((x) => x.id !== id) };
        });
      } catch (e) {
        if (!(e instanceof ErreurSoutien)) throw e;
        return rendre(res, { status: e.status, message: { type: 'erreur', texte: e.message } });
      }
      res.redirect(303, '/interne/soutien?ok=collecte_supprimee#collectes');
    } catch (e) {
      logger.error?.(`[interne] suppression de collecte : ${e?.message ?? ''}`);
      next(e);
    }
  });
}
