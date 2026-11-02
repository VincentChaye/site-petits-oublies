/**
 * Routes publiques : pages éditoriales, catalogue des animaux, fiches et
 * formulaires de mise en relation. Aucune de ces routes n'émet de cookie.
 * @module server/routes/public
 */
import express from 'express';
import { validateForm, FORM_SCHEMAS } from '../../security/validation.js';
import { honeypotPassed, issueFormToken, verifyFormToken, createRateLimiter } from '../../security/antispam.js';

/** Champ piège attendu par `src/views/public/partials/formulaire.ejs`. */
export const CHAMP_PIEGE = 'site_web';
/** Champ du jeton horodaté attendu par le même gabarit. */
export const CHAMP_JETON = '_form_token';

const etatVide = () => ({ valeurs: {}, erreurs: {}, envoye: false, erreurGenerale: false });

/** Remplace les messages génériques de validation par ceux du contenu éditorial. */
function messagesContenu(erreurs, def) {
  const out = {};
  for (const [champ, message] of Object.entries(erreurs)) {
    out[champ] = def?.champs?.[champ]?.erreur || message;
  }
  return out;
}

/**
 * Construit le routeur public.
 * @param {{contenu: any, soumissions: any, vues: any, baseUrl: string, secret: string,
 *          logger?: {error: Function, warn?: Function}, isProduction?: boolean}} deps
 * @returns {import('express').Router} Routeur.
 */
export function createPublicRouter({ contenu, soumissions, vues, baseUrl, secret, logger = console } = {}) {
  if (!contenu || !soumissions || !vues) throw new Error('createPublicRouter : contenu, soumissions et vues sont requis.');
  if (typeof secret !== 'string' || !secret) throw new Error('createPublicRouter : secret est requis.');

  const router = express.Router();
  const base = String(baseUrl || 'http://localhost:3000').replace(/\/$/, '');
  const limiteur = createRateLimiter({ max: 10, windowMs: 3600 * 1000 });
  const jeton = () => issueFormToken(secret);
  const commun = { baseUrl: base, formulaires: contenu.formulaires };

  /** Vérifie l'origine d'une requête mutante (défense CSRF des formulaires publics). */
  function origineValide(req) {
    const origin = req.headers.origin;
    if (origin === undefined) return true; // navigateurs anciens : le jeton signé reste exigé
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  }

  /**
   * Contrôles communs à toute soumission : origine, honeypot, jeton horodaté, débit.
   * @returns {{ok: true} | {ok: false, status: number, message: string}}
   */
  function controlesAntispam(req) {
    if (!origineValide(req)) return { ok: false, status: 403, message: 'Requête refusée : origine non autorisée.' };
    if (!honeypotPassed(req.body, CHAMP_PIEGE)) {
      logger.warn?.('[antispam] honeypot rempli : soumission ignorée.');
      return { ok: false, status: 400, message: 'Requête refusée.' };
    }
    const j = verifyFormToken(req.body?.[CHAMP_JETON], secret);
    if (!j.ok) return { ok: false, status: 400, message: j.message };
    const d = limiteur.check(req.ip ?? 'inconnue');
    if (!d.allowed) return { ok: false, status: 429, message: `Trop de demandes envoyées. Réessayez dans ${d.retryAfterSec} seconde(s).`, retryAfterSec: d.retryAfterSec };
    return { ok: true };
  }

  /**
   * Traite une soumission : contrôles anti-spam puis validation.
   * @returns {Promise<{envoye: true} | {envoye: false, etat: any, status: number, retryAfterSec?: number}>}
   */
  async function traiter(req, type, { def, extra = {}, valider } = {}) {
    const anti = controlesAntispam(req);
    const brut = validateForm(type, req.body);
    if (!anti.ok) {
      return {
        envoye: false,
        status: anti.status,
        retryAfterSec: anti.retryAfterSec,
        etat: { valeurs: brut.values, erreurs: messagesContenu(brut.errors, def), envoye: false, erreurGenerale: true, messageGeneral: anti.message },
      };
    }
    const erreurs = { ...brut.errors };
    if (valider) Object.assign(erreurs, valider(brut.values) ?? {});
    if (Object.keys(erreurs).length) {
      return {
        envoye: false,
        status: 400,
        etat: { valeurs: brut.values, erreurs: messagesContenu(erreurs, def), envoye: false, erreurGenerale: true },
      };
    }
    await soumissions.ajouter(type, { ...extra, ...brut.values });
    return { envoye: true };
  }

  // ── Accueil ────────────────────────────────────────────────────────────────
  router.get('/', (req, res) => {
    res.render('public/accueil', {
      ...commun,
      page: contenu.pages.accueil,
      vedettes: contenu.disponibles.slice(0, 4),
    });
  });

  // ── Catalogue ──────────────────────────────────────────────────────────────
  router.get('/animaux', (req, res) => {
    const permis = (champ, valeur) => contenu.options[champ].some((o) => o.valeur === valeur);
    const filtres = {
      espece: permis('especes', req.query.espece) ? String(req.query.espece) : '',
      tranche: permis('tranches', req.query.tranche) ? String(req.query.tranche) : '',
      taille: permis('tailles', req.query.taille) ? String(req.query.taille) : '',
    };
    const animaux = contenu.disponibles.filter((a) => (!filtres.espece || a.espece === filtres.espece)
      && (!filtres.tranche || a.tranche === filtres.tranche)
      && (!filtres.taille || a.taille === filtres.taille));
    res.render('public/animaux', { ...commun, page: contenu.pages.animaux, animaux, filtres, options: contenu.options });
  });

  // ── Fiche animal ───────────────────────────────────────────────────────────
  router.get('/animaux/:slug', (req, res, next) => {
    const animal = contenu.animal(req.params.slug);
    if (!animal) return next();
    vues.incrementer(animal.slug);
    res.render('public/animal', { ...commun, animal });
  });

  // ── Formulaire d'intérêt ───────────────────────────────────────────────────
  const rendreInteret = (res, animal, etat, status = 200) => res.status(status).render('public/interet', {
    ...commun, animal, etat, formToken: jeton(),
  });

  router.get('/animaux/:slug/interet', (req, res, next) => {
    const animal = contenu.animal(req.params.slug);
    if (!animal) return next();
    if (animal.statut !== 'disponible') return res.redirect(303, `/animaux/${animal.slug}`);
    const etat = etatVide();
    etat.envoye = req.query.envoye === '1';
    rendreInteret(res, animal, etat);
  });

  router.post('/animaux/:slug/interet', async (req, res, next) => {
    const animal = contenu.animal(req.params.slug);
    if (!animal) return next();
    if (animal.statut !== 'disponible') return res.redirect(303, `/animaux/${animal.slug}`);
    const r = await traiter(req, 'interet', { def: contenu.formulaires.interet, extra: { animal: animal.nom } });
    if (r.envoye) return res.redirect(303, `/animaux/${animal.slug}/interet?envoye=1#formulaire-interet`);
    if (r.retryAfterSec) res.set('Retry-After', String(r.retryAfterSec));
    rendreInteret(res, animal, r.etat, r.status);
  });

  // ── Le refuge : bénévolat, dons et parrainage ──────────────────────────────
  const rendreRefuge = (res, { etatBenevolat, etatDon } = {}, status = 200) => res.status(status).render('public/refuge', {
    ...commun,
    page: contenu.pages.refuge,
    animauxDisponibles: contenu.disponibles.map((a) => ({ slug: a.slug, nom: a.nom })),
    etatBenevolat: etatBenevolat ?? etatVide(),
    etatDon: etatDon ?? etatVide(),
    formToken: jeton(),
  });

  router.get('/refuge', (req, res) => {
    const envoye = String(req.query.envoye || '');
    rendreRefuge(res, {
      etatBenevolat: { ...etatVide(), envoye: envoye === 'benevolat' },
      etatDon: { ...etatVide(), envoye: envoye === 'don' },
    });
  });

  router.post('/refuge/benevolat', async (req, res) => {
    const r = await traiter(req, 'benevolat', { def: contenu.formulaires.benevolat });
    if (r.envoye) return res.redirect(303, '/refuge?envoye=benevolat#formulaire-benevolat');
    if (r.retryAfterSec) res.set('Retry-After', String(r.retryAfterSec));
    rendreRefuge(res, { etatBenevolat: r.etat }, r.status);
  });

  router.post('/refuge/don', async (req, res) => {
    const slugs = new Set(contenu.disponibles.map((a) => a.slug));
    const r = await traiter(req, 'don_parrainage', {
      def: contenu.formulaires.don_parrainage,
      valider: (v) => (v.animal && !slugs.has(v.animal) ? { animal: 'Cet animal n’est pas disponible.' } : {}),
    });
    if (r.envoye) return res.redirect(303, '/refuge?envoye=don#formulaire-don');
    if (r.retryAfterSec) res.set('Retry-After', String(r.retryAfterSec));
    rendreRefuge(res, { etatDon: r.etat }, r.status);
  });

  // ── Contact ────────────────────────────────────────────────────────────────
  const rendreContact = (res, etat, status = 200) => res.status(status).render('public/contact', {
    ...commun, page: contenu.pages.contact, etat, formToken: jeton(),
  });

  router.get('/contact', (req, res) => {
    rendreContact(res, { ...etatVide(), envoye: req.query.envoye === '1' });
  });

  router.post('/contact', async (req, res) => {
    const r = await traiter(req, 'contact', { def: contenu.formulaires.contact });
    if (r.envoye) return res.redirect(303, '/contact?envoye=1#formulaire-contact');
    if (r.retryAfterSec) res.set('Retry-After', String(r.retryAfterSec));
    rendreContact(res, r.etat, r.status);
  });

  // ── Pages légales ──────────────────────────────────────────────────────────
  router.get('/mentions-legales', (req, res) => {
    res.render('public/mentions-legales', { ...commun, page: contenu.pages.mentions_legales });
  });
  router.get('/confidentialite', (req, res) => {
    res.render('public/confidentialite', { ...commun, page: contenu.pages.confidentialite });
  });

  // ── Sitemap ────────────────────────────────────────────────────────────────
  router.get('/sitemap.xml', (req, res) => {
    const urls = [
      { loc: '/', priorite: '1.0' },
      { loc: '/animaux', priorite: '0.9' },
      { loc: '/refuge', priorite: '0.7' },
      { loc: '/contact', priorite: '0.6' },
      { loc: '/mentions-legales', priorite: '0.2' },
      { loc: '/confidentialite', priorite: '0.2' },
      ...contenu.disponibles.map((a) => ({ loc: `/animaux/${a.slug}`, priorite: '0.8' })),
    ];
    const corps = urls.map((u) => `  <url><loc>${base}${u.loc}</loc><priority>${u.priorite}</priority></url>`).join('\n');
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${corps}\n</urlset>\n`);
  });

  // ── 404 ────────────────────────────────────────────────────────────────────
  router.use((req, res) => {
    res.status(404).render('public/404', { ...commun, url: req.path });
  });

  return router;
}

/** Noms des champs attendus par chaque formulaire (utile aux tests). */
export const CHAMPS_PAR_FORMULAIRE = Object.freeze(
  Object.fromEntries(Object.entries(FORM_SCHEMAS).map(([k, v]) => [k, Object.freeze(Object.keys(v))])),
);
