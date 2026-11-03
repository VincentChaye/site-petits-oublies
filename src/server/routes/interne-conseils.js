/**
 * Fiches conseils depuis /interne : liste, création, modification, suppression.
 * Calqué sur `interne-animaux.js` : à monter APRÈS la garde de session et le
 * CSRF, écriture atomique via `contenu.modifierConseils`, champ `_version` et
 * refus 409 d'une version périmée.
 * @module server/routes/interne-conseils
 */
import { validerConseil, ecrireSections, OUTILS, LIBELLES_TYPE } from '../conseils-validation.js';
import { TYPES_SECTION } from '../content.js';

const MESSAGES = Object.freeze({
  cree: { type: 'succes', texte: 'Fiche conseil créée : elle est en ligne.' },
  modifie: { type: 'succes', texte: 'Fiche conseil enregistrée.' },
  supprime: { type: 'succes', texte: 'Fiche conseil supprimée.' },
});

/** Erreur métier portant un code HTTP. */
class ErreurFiche extends Error {
  constructor(status, message, champ = '_general') {
    super(message);
    this.status = status;
    this.champ = champ;
  }
}

const versionDe = (f) => (Number.isInteger(f?._version) && f._version >= 0 ? f._version : 0);
const MSG_PERIME = 'Cette fiche a été modifiée par quelqu’un d’autre depuis l’ouverture du formulaire. Rechargez la page pour repartir de la version à jour.';

/**
 * @param {import('express').Router} router
 * @param {{contenu: any, logger?: {error: Function}}} deps
 */
export function monterConseils(router, { contenu, logger = console }) {
  const aide = {
    types: TYPES_SECTION.map((cle) => ({ cle, libelle: LIBELLES_TYPE[cle] ?? cle })),
    outils: Object.entries(OUTILS).map(([cle, libelle]) => ({ cle, libelle })),
  };

  const rendreListe = (res, { status = 200, message = null } = {}) => res.status(status).render('interne/conseils', {
    conseils: contenu.conseils.map((c) => ({
      slug: c.slug, titre: c.titre, sections: c.sections.length, outil: OUTILS[c.outil ?? ''] ?? c.outil, version: versionDe(c),
    })),
    message,
  });

  const rendreFormulaire = (res, { creation, slug, valeurs, erreurs = {}, version = 0, status = 200 }) => res.status(status).render('interne/conseil-formulaire', {
    creation, slug, valeurs, erreurs, version, aide, message: null,
  });

  const valeursDe = (c) => ({
    slug: c.slug, titre: c.titre, resume: c.resume ?? '', icone: c.icone ?? '', outil: c.outil ?? '',
    sections: ecrireSections(c.sections),
  });

  // ── Liste ──
  router.get('/conseils', (req, res, next) => {
    try {
      rendreListe(res, { message: MESSAGES[String(req.query.ok ?? '')] ?? null });
    } catch (e) { next(e); }
  });

  // ── Création ──
  router.get('/conseils/nouveau', (req, res, next) => {
    try {
      rendreFormulaire(res, {
        creation: true,
        slug: '',
        valeurs: { slug: '', titre: '', resume: '', icone: '', outil: '', sections: 'texte: Titre de la première section\nÉcrivez ici le texte de la section.' },
      });
    } catch (e) { next(e); }
  });

  router.post('/conseils/nouveau', async (req, res, next) => {
    try {
      const v = validerConseil(req.body, { creation: true, slugsExistants: new Set(contenu.conseils.map((c) => c.slug)) });
      if (!v.fiche) return rendreFormulaire(res, { creation: true, slug: '', valeurs: v.valeurs, erreurs: v.erreurs, status: 422 });
      const fiche = { ...v.fiche, _version: 1 };
      try {
        await contenu.modifierConseils((liste) => {
          if (liste.some((c) => c.slug === fiche.slug)) throw new ErreurFiche(422, 'Cet identifiant (slug) est déjà utilisé par une autre fiche.', 'slug');
          return [...liste, fiche];
        });
      } catch (e) {
        if (!(e instanceof ErreurFiche)) throw e;
        return rendreFormulaire(res, { creation: true, slug: '', valeurs: v.valeurs, erreurs: { [e.champ]: e.message }, status: e.status });
      }
      res.redirect(303, '/interne/conseils?ok=cree');
    } catch (e) { next(e); }
  });

  // ── Modification ──
  router.get('/conseils/:slug/modifier', (req, res, next) => {
    try {
      const c = contenu.conseil(req.params.slug);
      if (!c) return next();
      rendreFormulaire(res, { creation: false, slug: c.slug, valeurs: valeursDe(c), version: versionDe(c) });
    } catch (e) { next(e); }
  });

  router.post('/conseils/:slug/modifier', async (req, res, next) => {
    try {
      const actuelle = contenu.conseil(req.params.slug);
      if (!actuelle) return next();
      const slug = actuelle.slug;
      const v = validerConseil(req.body, { creation: false, slugActuel: slug });
      if (!v.fiche) {
        return rendreFormulaire(res, { creation: false, slug, valeurs: v.valeurs, erreurs: v.erreurs, version: versionDe(actuelle), status: 422 });
      }
      try {
        await contenu.modifierConseils((liste) => {
          const i = liste.findIndex((c) => c.slug === slug);
          if (i < 0) throw new ErreurFiche(404, 'Fiche introuvable.');
          if (versionDe(liste[i]) !== v.version) throw new ErreurFiche(409, MSG_PERIME, '_version');
          liste[i] = { ...liste[i], ...v.fiche, _version: v.version + 1 };
          return liste;
        });
      } catch (e) {
        if (!(e instanceof ErreurFiche)) throw e;
        if (e.status === 404) return next();
        const courante = contenu.conseil(slug);
        return rendreFormulaire(res, { creation: false, slug, valeurs: v.valeurs, erreurs: { [e.champ]: e.message }, version: versionDe(courante), status: e.status });
      }
      res.redirect(303, '/interne/conseils?ok=modifie');
    } catch (e) { next(e); }
  });

  // ── Suppression ──
  router.post('/conseils/:slug/supprimer', async (req, res, next) => {
    try {
      const actuelle = contenu.conseil(req.params.slug);
      if (!actuelle) return next();
      const slug = actuelle.slug;
      const brut = typeof req.body?._version === 'string' ? req.body._version.trim() : '';
      if (!/^\d{1,9}$/.test(brut)) {
        return rendreListe(res, { status: 422, message: { type: 'erreur', texte: 'Version de la fiche manquante ou invalide : rechargez la liste.' } });
      }
      const attendue = Number(brut);
      try {
        await contenu.modifierConseils((liste) => {
          const i = liste.findIndex((c) => c.slug === slug);
          if (i < 0) throw new ErreurFiche(404, 'Fiche introuvable.');
          if (versionDe(liste[i]) !== attendue) throw new ErreurFiche(409, MSG_PERIME);
          liste.splice(i, 1);
          return liste;
        });
      } catch (e) {
        if (!(e instanceof ErreurFiche)) throw e;
        if (e.status === 404) return next();
        return rendreListe(res, { status: e.status, message: { type: 'erreur', texte: e.message } });
      }
      res.redirect(303, '/interne/conseils?ok=supprime');
    } catch (e) {
      logger.error?.(`[interne] suppression de fiche conseil : ${e?.message ?? ''}`);
      next(e);
    }
  });
}
