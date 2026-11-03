/**
 * Gestion des fiches animaux depuis /interne : liste, création, modification,
 * changement de statut (adoptable, en soins, adopté). À appeler APRÈS la garde
 * de session et le CSRF (tout POST exige donc un jeton valide).
 * @module server/routes/interne-animaux
 */
import { validerFiche, CHAMPS_OBLIGATOIRES, STATUTS, SEXES } from '../animaux-validation.js';
import { LIBELLES_ESPECE, LIBELLES_TRANCHE, LIBELLES_TAILLE } from '../content.js';

const MESSAGES = Object.freeze({
  cree: { type: 'succes', texte: 'Fiche créée.' },
  modifie: { type: 'succes', texte: 'Fiche enregistrée.' },
  statut: { type: 'succes', texte: 'Statut mis à jour.' },
});

/** Erreur métier portant un code HTTP. */
class ErreurFiche extends Error {
  constructor(status, message, champ = '_general') {
    super(message);
    this.status = status;
    this.champ = champ;
  }
}

const versionDe = (fiche) => (Number.isInteger(fiche?._version) && fiche._version >= 0 ? fiche._version : 0);
const MSG_PERIME = 'Cette fiche a été modifiée par quelqu’un d’autre depuis l’ouverture du formulaire. Rechargez la page pour repartir de la version à jour.';

/**
 * @param {import('express').Router} router
 * @param {{contenu: any, logger?: {error: Function}}} deps
 */
export function monterAnimaux(router, { contenu, logger = console }) {
  const listes = {
    especes: LIBELLES_ESPECE, tranches: LIBELLES_TRANCHE, tailles: LIBELLES_TAILLE, sexes: SEXES, statuts: STATUTS,
  };

  const rendreListe = (res, { status = 200, message = null } = {}) => res.status(status).render('interne/animaux', {
    animaux: contenu.animaux.map((a) => ({ slug: a.slug, nom: a.nom, espece: LIBELLES_ESPECE[a.espece] ?? a.espece, statut: a.statut, version: versionDe(a) })),
    statuts: STATUTS,
    message,
  });

  const rendreFormulaire = (res, { creation, slug, valeurs, erreurs = {}, version = 0, status = 200 }) => res.status(status).render('interne/animal-formulaire', {
    creation, slug, valeurs, erreurs, version, listes, obligatoires: CHAMPS_OBLIGATOIRES,
    message: null,
  });

  const valeursDe = (a) => ({
    slug: a.slug, nom: a.nom, espece: a.espece, race: a.race, age: String(a.age), tranche: a.tranche, taille: a.taille,
    sexe: a.sexe, dateArrivee: a.dateArrivee, statut: a.statut, caractere: a.caractere, besoins: a.besoins, histoire: a.histoire,
    photo_src: a.photos?.[0]?.src ?? '', photo_alt: a.photos?.[0]?.alt ?? '',
  });

  // ── Liste ──
  router.get('/animaux', (req, res, next) => {
    try {
      rendreListe(res, { message: MESSAGES[String(req.query.ok ?? '')] ?? null });
    } catch (e) { next(e); }
  });

  // ── Création ──
  router.get('/animaux/nouveau', (req, res, next) => {
    try {
      rendreFormulaire(res, { creation: true, slug: '', valeurs: { statut: 'disponible' } });
    } catch (e) { next(e); }
  });

  router.post('/animaux/nouveau', async (req, res, next) => {
    try {
      const v = validerFiche(req.body, { creation: true, slugsExistants: new Set(contenu.animaux.map((a) => a.slug)) });
      if (v.fiche) {
        const fiche = { ...v.fiche, _version: 1 };
        try {
          await contenu.modifierAnimaux((liste) => {
            if (liste.some((a) => a.slug === fiche.slug)) throw new ErreurFiche(422, 'Cet identifiant (slug) est déjà utilisé par une autre fiche.', 'slug');
            return [...liste, fiche];
          });
        } catch (e) {
          if (!(e instanceof ErreurFiche)) throw e;
          return rendreFormulaire(res, { creation: true, slug: '', valeurs: v.valeurs, erreurs: { [e.champ]: e.message }, status: e.status });
        }
        return res.redirect(303, '/interne/animaux?ok=cree');
      }
      rendreFormulaire(res, { creation: true, slug: '', valeurs: v.valeurs, erreurs: v.erreurs, status: 422 });
    } catch (e) { next(e); }
  });

  // ── Modification ──
  router.get('/animaux/:slug/modifier', (req, res, next) => {
    try {
      const a = contenu.animal(req.params.slug);
      if (!a) return next();
      rendreFormulaire(res, { creation: false, slug: a.slug, valeurs: valeursDe(a), version: versionDe(a) });
    } catch (e) { next(e); }
  });

  router.post('/animaux/:slug/modifier', async (req, res, next) => {
    try {
      const actuelle = contenu.animal(req.params.slug);
      if (!actuelle) return next();
      const slug = actuelle.slug;
      const v = validerFiche(req.body, { creation: false, slugActuel: slug });
      if (!v.fiche) {
        return rendreFormulaire(res, { creation: false, slug, valeurs: v.valeurs, erreurs: v.erreurs, version: versionDe(actuelle), status: 422 });
      }
      try {
        await contenu.modifierAnimaux((liste) => {
          const i = liste.findIndex((a) => a.slug === slug);
          if (i < 0) throw new ErreurFiche(404, 'Fiche introuvable.');
          if (versionDe(liste[i]) !== v.version) throw new ErreurFiche(409, MSG_PERIME, '_version');
          const photos = [...(v.fiche.photos), ...(Array.isArray(liste[i].photos) ? liste[i].photos.slice(1) : [])];
          liste[i] = { ...liste[i], ...v.fiche, photos, _version: v.version + 1 };
          return liste;
        });
      } catch (e) {
        if (!(e instanceof ErreurFiche)) throw e;
        if (e.status === 404) return next();
        const courante = contenu.animal(slug);
        return rendreFormulaire(res, { creation: false, slug, valeurs: v.valeurs, erreurs: { [e.champ]: e.message }, version: versionDe(courante), status: e.status });
      }
      res.redirect(303, '/interne/animaux?ok=modifie');
    } catch (e) { next(e); }
  });

  // ── Changement de statut (valeur cible explicite) ──
  router.post('/animaux/:slug/statut', async (req, res, next) => {
    try {
      const actuelle = contenu.animal(req.params.slug);
      if (!actuelle) return next();
      const slug = actuelle.slug;
      const brut = req.body?._version;
      if (typeof brut !== 'string' || !/^\d{1,9}$/.test(brut.trim())) {
        return rendreListe(res, { status: 422, message: { type: 'erreur', texte: 'Version de la fiche manquante ou invalide : rechargez la liste.' } });
      }
      const attendue = Number(brut);
      // Statut cible explicite, validé en liste blanche : jamais une bascule devinée.
      const cible = typeof req.body?.statut === 'string' ? req.body.statut.trim() : '';
      if (!Object.hasOwn(STATUTS, cible)) {
        const permis = Object.keys(STATUTS).join(', ');
        return rendreListe(res, { status: 422, message: { type: 'erreur', texte: `Statut inconnu : choisissez ${permis}.` } });
      }
      try {
        await contenu.modifierAnimaux((liste) => {
          const i = liste.findIndex((a) => a.slug === slug);
          if (i < 0) throw new ErreurFiche(404, 'Fiche introuvable.');
          if (versionDe(liste[i]) !== attendue) throw new ErreurFiche(409, MSG_PERIME);
          liste[i] = { ...liste[i], statut: cible, _version: attendue + 1 };
          return liste;
        });
      } catch (e) {
        if (!(e instanceof ErreurFiche)) throw e;
        if (e.status === 404) return next();
        return rendreListe(res, { status: e.status, message: { type: 'erreur', texte: e.message } });
      }
      res.redirect(303, '/interne/animaux?ok=statut');
    } catch (e) {
      logger.error?.(`[interne] changement de statut : ${e?.message ?? ''}`);
      next(e);
    }
  });
}
