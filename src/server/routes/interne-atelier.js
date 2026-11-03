/**
 * Atelier de publication (/interne/atelier) : rédaction manuelle d'un post, aperçu au format
 * du réseau (sans aucune écriture), dépôt dans la file de validation. À appeler APRÈS la
 * garde de session et le CSRF. Image et lien viennent TOUJOURS de la fiche, jamais du formulaire.
 * @module server/routes/interne-atelier
 */
import { TRIGGERS, renderTemplate } from '../../integrations/index.js';
import { isAvailable } from '../../integrations/service/animal.js';

export const RESEAUX_ATELIER = Object.freeze(['instagram', 'facebook']);
export const LIBELLES_RESEAU = Object.freeze({ instagram: 'Instagram', facebook: 'Facebook' });
export const CADRAGES_INSTAGRAM = Object.freeze({ '1:1': { libelle: 'Carré 1:1', classe: 'apercu-instagram-1-1', largeur: 1080, hauteur: 1080 }, '4:5': { libelle: 'Portrait 4:5', classe: 'apercu-instagram-4-5', largeur: 1080, hauteur: 1350 } });
export const CADRAGE_FACEBOOK = Object.freeze({ libelle: 'Paysage 1,91:1', classe: 'apercu-facebook', largeur: 1200, hauteur: 628 });
export const INSTAGRAM_MAX = 2200; // points de code
export const FACEBOOK_MAX = 5000; // .length, même unité que edit()
export const HASHTAGS_MAX = Object.freeze({ instagram: 30, facebook: 10 });
export const ALT_MAX = 300; // points de code
/** Nombre de caractères visibles avant « … plus » dans l'aperçu. */
export const SEUIL_COUPE = Object.freeze({ instagram: 125, facebook: 480 });
const RE_HASHTAG = /^#[\p{L}\p{N}_]+$/u;
const CHAMPS = Object.freeze(['animal', 'reseau', 'gabarit', 'cadrage', 'texte', 'hashtags', 'alt']);
const LIBELLES_CHAMP = Object.freeze({ animal: 'fiche', reseau: 'réseau', gabarit: 'gabarit', cadrage: 'cadrage', texte: 'texte', hashtags: 'hashtags', alt: 'texte alternatif' });
const nettoyer = (s) => s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
const pts = (s) => [...s].length;

/** Coupe un texte à `seuil` points de code pour l'aperçu. */
export function couperApercu(texte, seuil) {
  const car = [...texte];
  return car.length > seuil ? { visible: car.slice(0, seuil).join('').trimEnd(), coupe: true } : { visible: texte, coupe: false };
}

/**
 * Valide la saisie. Ne lit que les champs de la liste blanche ; toute valeur non-chaîne est refusée.
 * @returns {{erreurs: string[], valeurs: Record<string,string>, animal?: any, reseau?: string, cadrage?: string, tags?: string[], texteFinal?: string, alt?: string}}
 */
export function validerAtelier(corps, { contenu }) {
  const brut = corps && typeof corps === 'object' ? corps : {};
  const erreurs = [];
  const valeurs = {};
  for (const c of CHAMPS) {
    const v = Object.hasOwn(brut, c) ? brut[c] : '';
    if (typeof v !== 'string') { erreurs.push(`Le champ « ${LIBELLES_CHAMP[c]} » est invalide.`); valeurs[c] = ''; } else valeurs[c] = v;
  }
  if (erreurs.length) return { erreurs, valeurs };

  const fiche = contenu.animal(valeurs.animal.trim());
  if (!fiche) erreurs.push('Choisissez une fiche existante.');
  else if (!isAvailable(fiche)) erreurs.push('Cette fiche est adoptée ou en soins : on ne dépose pas de publication à son sujet.');
  const reseau = valeurs.reseau;
  if (!RESEAUX_ATELIER.includes(reseau)) erreurs.push('Réseau invalide : choisissez Instagram ou Facebook.');
  if (valeurs.gabarit !== '' && !TRIGGERS.includes(valeurs.gabarit)) erreurs.push('Gabarit inconnu.');
  let cadrage = '';
  if (reseau === 'instagram') {
    cadrage = valeurs.cadrage === '' ? '1:1' : valeurs.cadrage;
    if (!Object.hasOwn(CADRAGES_INSTAGRAM, cadrage)) { erreurs.push('Cadrage invalide : choisissez 1:1 ou 4:5.'); cadrage = ''; }
  } else if (valeurs.cadrage !== '' && !Object.hasOwn(CADRAGES_INSTAGRAM, valeurs.cadrage)) erreurs.push('Cadrage invalide.');

  const texte = nettoyer(valeurs.texte).trim();
  if (!texte) erreurs.push('Le texte est obligatoire.');

  const tags = [];
  const vus = new Set();
  for (const mot of nettoyer(valeurs.hashtags).split(/[\s,]+/).filter(Boolean)) {
    if (!RE_HASHTAG.test(mot)) { erreurs.push(`Hashtag invalide : « ${mot} » (un « # » suivi de lettres, chiffres ou « _ »).`); continue; }
    const cle = mot.toLowerCase();
    if (!vus.has(cle)) { vus.add(cle); tags.push(mot); }
  }
  const alt = nettoyer(valeurs.alt).trim();
  if (pts(alt) > ALT_MAX) erreurs.push(`Le texte alternatif est trop long (${pts(alt)} caractères, maximum ${ALT_MAX}).`);

  const texteFinal = tags.length ? `${texte}\n\n${tags.join(' ')}` : texte;
  if (RESEAUX_ATELIER.includes(reseau)) {
    if (tags.length > HASHTAGS_MAX[reseau]) erreurs.push(`Trop de hashtags pour ${LIBELLES_RESEAU[reseau]} : ${tags.length} (maximum ${HASHTAGS_MAX[reseau]}).`);
    if (reseau === 'instagram' && pts(texteFinal) > INSTAGRAM_MAX) erreurs.push(`Texte trop long pour Instagram : ${pts(texteFinal)} caractères avec les hashtags (maximum ${INSTAGRAM_MAX}).`);
    if (reseau === 'facebook' && texteFinal.length > FACEBOOK_MAX) erreurs.push(`Texte trop long pour Facebook : ${texteFinal.length} caractères avec les hashtags (maximum ${FACEBOOK_MAX}).`);
    if (reseau === 'instagram' && fiche && !fiche.photos?.[0]?.src) erreurs.push('Instagram exige une image : cette fiche n’a pas de photo.');
  }
  return { erreurs, valeurs, animal: fiche, reseau, cadrage, tags, texteFinal, alt };
}

/**
 * @param {import('express').Router} router
 * @param {{contenu: any, social: any, logger?: {error: Function}}} deps
 */
export function monterAtelier(router, { contenu, social, logger = console }) {
  const versService = (a) => ({ id: a.slug, slug: a.slug, nom: a.nom, espece: a.espece, statut: a.statut, dateArrivee: a.dateArrivee, photos: a.photos });

  const rendre = (res, { status = 200, valeurs = {}, erreurs = [], apercu = null, message = null } = {}) => {
    const etats = social.service.connectorsStatus();
    res.status(status).render('interne/atelier', {
      valeurs: { animal: '', reseau: 'instagram', gabarit: '', cadrage: '1:1', texte: '', hashtags: '', alt: '', ...valeurs },
      erreurs,
      apercu,
      message: message ?? (erreurs.length ? { type: 'erreur', texte: 'Saisie à corriger : voir la liste ci-dessous.' } : null),
      animaux: contenu.disponibles.map((a) => ({ slug: a.slug, nom: a.nom })),
      reseaux: RESEAUX_ATELIER.map((cle) => ({ cle, libelle: LIBELLES_RESEAU[cle], active: !!etats.find((e) => e.platform === cle)?.enabled })),
      gabarits: TRIGGERS,
      cadrages: Object.entries(CADRAGES_INSTAGRAM).map(([cle, c]) => ({ cle, libelle: c.libelle })),
      limites: { instagram: INSTAGRAM_MAX, facebook: FACEBOOK_MAX },
    });
  };

  // ── Formulaire, avec préremplissage par GET (sans JS) ──
  router.get('/atelier', (req, res, next) => {
    try {
      const q = req.query ?? {};
      const erreurs = [];
      const valeurs = {};
      for (const c of ['animal', 'reseau', 'gabarit', 'cadrage']) {
        if (q[c] === undefined || q[c] === '') continue;
        if (typeof q[c] !== 'string') { erreurs.push(`Le paramètre « ${LIBELLES_CHAMP[c]} » est invalide.`); continue; }
        valeurs[c] = q[c];
      }
      const fiche = valeurs.animal ? contenu.animal(valeurs.animal) : null;
      if (valeurs.animal && (!fiche || !isAvailable(fiche))) { erreurs.push('Fiche inconnue, adoptée ou en soins.'); delete valeurs.animal; }
      if (valeurs.reseau && !RESEAUX_ATELIER.includes(valeurs.reseau)) { erreurs.push('Réseau invalide.'); delete valeurs.reseau; }
      if (valeurs.gabarit && !TRIGGERS.includes(valeurs.gabarit)) { erreurs.push('Gabarit inconnu.'); delete valeurs.gabarit; }
      if (valeurs.cadrage && !Object.hasOwn(CADRAGES_INSTAGRAM, valeurs.cadrage)) { erreurs.push('Cadrage invalide.'); delete valeurs.cadrage; }
      const g = valeurs.gabarit && valeurs.reseau ? social.gabarits?.[valeurs.gabarit]?.[valeurs.reseau] : null;
      if (fiche && g) {
        valeurs.texte = renderTemplate(g.texte, social.service.variablesAnimal(versService(fiche)));
        valeurs.hashtags = g.hashtags.join(' ');
      }
      rendre(res, { status: erreurs.length ? 422 : 200, valeurs, erreurs });
    } catch (e) { next(e); }
  });

  // ── Aperçu : AUCUNE écriture ──
  router.post('/atelier/apercu', (req, res, next) => {
    try {
      const v = validerAtelier(req.body, { contenu });
      if (v.erreurs.length) return rendre(res, { status: 422, valeurs: v.valeurs, erreurs: v.erreurs });
      const cad = v.reseau === 'instagram' ? CADRAGES_INSTAGRAM[v.cadrage] : CADRAGE_FACEBOOK;
      const coupe = couperApercu(v.texteFinal, SEUIL_COUPE[v.reseau]);
      const photo = v.animal.photos?.[0] ?? null;
      const url = social.service.variablesAnimal(versService(v.animal)).url;
      const max = v.reseau === 'instagram' ? INSTAGRAM_MAX : FACEBOOK_MAX;
      rendre(res, {
        valeurs: v.valeurs,
        apercu: {
          reseau: v.reseau, reseauLibelle: LIBELLES_RESEAU[v.reseau], cadrageLibelle: cad.libelle, classe: cad.classe,
          largeur: cad.largeur, hauteur: cad.hauteur,
          image: photo?.src ?? null, imageAlt: v.alt || photo?.alt || '',
          longueur: v.reseau === 'instagram' ? pts(v.texteFinal) : v.texteFinal.length, max,
          visible: coupe.visible, coupe: coupe.coupe, seuil: SEUIL_COUPE[v.reseau],
          hashtags: v.tags, nom: v.animal.nom, url, lienCliquable: v.reseau === 'facebook',
        },
      });
    } catch (e) { next(e); }
  });

  // ── Dépôt dans la file de validation ──
  router.post('/atelier/deposer', (req, res, next) => {
    try {
      const v = validerAtelier(req.body, { contenu });
      if (v.erreurs.length) return rendre(res, { status: 422, valeurs: v.valeurs, erreurs: v.erreurs });
      const fiche = v.animal; // retrouvée par slug à l'instant du POST
      try {
        social.service.deposerManuel({
          animal: versService(fiche), platform: v.reseau, text: v.texteFinal,
          imageUrl: fiche.photos?.[0]?.src, alt: v.alt || undefined, gabarit: v.valeurs.gabarit || undefined,
        });
      } catch (e) {
        if (e?.name !== 'SocialError') throw e;
        logger.error?.(`[atelier] dépôt refusé : ${e.code}`);
        const detail = Array.isArray(e.details) && e.details.length ? e.details : [e.message];
        return rendre(res, { status: 422, valeurs: v.valeurs, erreurs: detail });
      }
      res.redirect(303, '/interne/file?ok=depose');
    } catch (e) { next(e); }
  });
}
