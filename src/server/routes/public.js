/**
 * Routes publiques : pages éditoriales, catalogue des animaux, fiches conseils
 * et formulaires de mise en relation. Aucune de ces routes n'émet de cookie.
 * @module server/routes/public
 */
import express from 'express';
import { validateForm, FORM_SCHEMAS } from '../../security/validation.js';
import { honeypotPassed, issueFormToken, verifyFormToken, createRateLimiter } from '../../security/antispam.js';
import { verifierMemeOrigine } from '../../security/origine.js';

/** Champ piège attendu par `src/views/public/partials/formulaire.ejs`. */
export const CHAMP_PIEGE = 'site_web';
/** Champ du jeton horodaté attendu par le même gabarit. */
export const CHAMP_JETON = '_form_token';

/** Statuts pour lesquels un projet d'adoption peut être déposé. */
const STATUTS_OUVERTS = Object.freeze(['disponible', 'en_soins']);

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
 *          logger?: {error: Function, warn?: Function}, isProduction?: boolean,
 *          maxEnvois?: number, fenetreEnvoisMs?: number}} deps
 *   maxEnvois / fenetreEnvoisMs : limitation de débit des envois de formulaire
 *   (10 par heure et par adresse en production ; relevé par les tests).
 *   statique : rendu pour l'export statique (aucun envoi possible).
 * @returns {import('express').Router} Routeur.
 */
export function createPublicRouter({
  contenu, soumissions, vues, baseUrl, secret, logger = console,
  maxEnvois = 10, fenetreEnvoisMs = 3600 * 1000, statique = false,
} = {}) {
  if (!contenu || !soumissions || !vues) throw new Error('createPublicRouter : contenu, soumissions et vues sont requis.');
  if (typeof secret !== 'string' || !secret) throw new Error('createPublicRouter : secret est requis.');

  const router = express.Router();
  const base = String(baseUrl || 'http://localhost:3000').replace(/\/$/, '');
  const limiteur = createRateLimiter({ max: maxEnvois, windowMs: fenetreEnvoisMs });
  const jeton = () => issueFormToken(secret);
  const commun = {
    baseUrl: base,
    formulaires: contenu.formulaires,
    association: contenu.pages.association,
    rgpdCommun: contenu.formulaires._rgpd_commun,
    // Export statique (GitHub Pages) : formulaires remplacés par les coordonnées.
    statique,
  };

  /**
   * Contrôles communs à toute soumission : origine, honeypot, jeton horodaté, débit.
   * @returns {{ok: true} | {ok: false, status: number, message: string}}
   */
  function controlesAntispam(req) {
    // Provenance : Sec-Fetch-Site d'abord. Avec `Referrer-Policy: no-referrer`, un
    // navigateur envoie `Origin: null` sur un POST de même origine ; se fier à Origin
    // seul refuserait tous les envois de formulaire. Le jeton signé reste exigé ensuite.
    if (!verifierMemeOrigine(req).ok) return { ok: false, status: 403, message: 'Requête refusée : origine non autorisée.' };
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
      vedettes: contenu.visibles.slice(0, 4),
    });
  });

  // ── Nos missions (remplace l'ancienne page /refuge) ────────────────────────
  router.get('/nos-missions', (req, res) => {
    res.render('public/nos-missions', { ...commun, page: contenu.pages.nos_missions });
  });
  // Redirections permanentes : les anciennes adresses restent suivies.
  router.get('/refuge', (req, res) => res.redirect(301, '/nos-missions'));

  // ── Catalogue ──────────────────────────────────────────────────────────────
  router.get('/adopter', (req, res) => {
    const permis = (champ, valeur) => contenu.options[champ].some((o) => o.valeur === valeur);
    const filtres = {
      espece: permis('especes', req.query.espece) ? String(req.query.espece) : '',
      tranche: permis('tranches', req.query.tranche) ? String(req.query.tranche) : '',
      taille: permis('tailles', req.query.taille) ? String(req.query.taille) : '',
    };
    const animaux = contenu.visibles.filter((a) => (!filtres.espece || a.espece === filtres.espece)
      && (!filtres.tranche || a.tranche === filtres.tranche)
      && (!filtres.taille || a.taille === filtres.taille));
    res.render('public/animaux', { ...commun, page: contenu.pages.animaux, animaux, filtres, options: contenu.options });
  });
  router.get('/animaux', (req, res) => {
    const q = new URLSearchParams(Object.entries(req.query).filter(([, v]) => typeof v === 'string')).toString();
    res.redirect(301, q ? `/adopter?${q}` : '/adopter');
  });

  // ── Fiche animal (chemin conservé : les liens déjà partagés restent valides) ─
  router.get('/animaux/:slug', (req, res, next) => {
    const animal = contenu.animal(req.params.slug);
    if (!animal) return next();
    vues.incrementer(animal.slug);
    res.render('public/animal', { ...commun, animal });
  });

  // ── Projet d'adoption ──────────────────────────────────────────────────────
  const rendreInteret = (res, animal, etat, status = 200) => res.status(status).render('public/interet', {
    ...commun, animal, etat, formToken: jeton(),
  });

  router.get('/animaux/:slug/interet', (req, res, next) => {
    const animal = contenu.animal(req.params.slug);
    if (!animal) return next();
    if (!STATUTS_OUVERTS.includes(animal.statut)) return res.redirect(303, `/animaux/${animal.slug}`);
    const etat = etatVide();
    etat.envoye = req.query.envoye === '1';
    rendreInteret(res, animal, etat);
  });

  router.post('/animaux/:slug/interet', async (req, res, next) => {
    const animal = contenu.animal(req.params.slug);
    if (!animal) return next();
    if (!STATUTS_OUVERTS.includes(animal.statut)) return res.redirect(303, `/animaux/${animal.slug}`);
    const r = await traiter(req, 'interet', { def: contenu.formulaires.interet, extra: { animal: animal.nom, animalSlug: animal.slug } });
    if (r.envoye) return res.redirect(303, `/animaux/${animal.slug}/interet?envoye=1#formulaire-interet`);
    if (r.retryAfterSec) res.set('Retry-After', String(r.retryAfterSec));
    rendreInteret(res, animal, r.etat, r.status);
  });

  // ── Devenir famille d'accueil ──────────────────────────────────────────────
  const rendreFamille = (res, etat, status = 200) => res.status(status).render('public/famille-accueil', {
    ...commun, page: contenu.pages.famille_accueil, etat, formToken: jeton(),
  });

  router.get('/famille-accueil', (req, res) => {
    rendreFamille(res, { ...etatVide(), envoye: req.query.envoye === '1' });
  });

  router.post('/famille-accueil', async (req, res) => {
    const r = await traiter(req, 'famille_accueil', { def: contenu.formulaires.famille_accueil });
    if (r.envoye) return res.redirect(303, '/famille-accueil?envoye=1#formulaire-famille-accueil');
    if (r.retryAfterSec) res.set('Retry-After', String(r.retryAfterSec));
    rendreFamille(res, r.etat, r.status);
  });

  // ── Nous soutenir : adhésion / don, matériel, bénévolat, collectes ─────────
  /** Collectes à venir seulement : une date passée disparaît d'elle-même. */
  const collectesAVenir = () => {
    const aujourdhui = new Date().toISOString().slice(0, 10);
    return contenu.soutien.collectes
      .filter((c) => typeof c.date === 'string' && c.date >= aujourdhui)
      .sort((a, b) => a.date.localeCompare(b.date));
  };

  const rendreSoutien = (res, { etatAdhesion, etatBenevolat } = {}, status = 200) => res.status(status).render('public/soutenir', {
    ...commun,
    page: contenu.pages.soutenir,
    soutien: contenu.soutien,
    collectes: collectesAVenir(),
    etatAdhesion: etatAdhesion ?? etatVide(),
    etatBenevolat: etatBenevolat ?? etatVide(),
    formToken: jeton(),
  });

  router.get('/nous-soutenir', (req, res) => {
    const envoye = String(req.query.envoye || '');
    rendreSoutien(res, {
      etatAdhesion: { ...etatVide(), envoye: envoye === 'adhesion' },
      etatBenevolat: { ...etatVide(), envoye: envoye === 'benevolat' },
    });
  });

  router.post('/nous-soutenir/adhesion', async (req, res) => {
    const r = await traiter(req, 'adhesion', {
      def: contenu.formulaires.adhesion,
      // Dépendances entre champs : vérifiées côté serveur, jamais seulement en HTML.
      valider: (v) => {
        const e = {};
        if (v.formule === 'adhesion_jeune') {
          if (!v.representant_nom) e.representant_nom = 'Indiquez le nom du représentant légal.';
          if (!v.representant_prenom) e.representant_prenom = 'Indiquez le prénom du représentant légal.';
          if (v.representant_accord !== 'oui') e.representant_accord = "L'accord du représentant légal est obligatoire pour une adhésion jeune.";
        }
        if (v.formule === 'don_libre' && !v.montant) e.montant = 'Indiquez le montant de votre don, en euros.';
        return e;
      },
    });
    if (r.envoye) return res.redirect(303, '/nous-soutenir?envoye=adhesion#formulaire-adhesion');
    if (r.retryAfterSec) res.set('Retry-After', String(r.retryAfterSec));
    rendreSoutien(res, { etatAdhesion: r.etat }, r.status);
  });

  router.post('/nous-soutenir/benevolat', async (req, res) => {
    const r = await traiter(req, 'benevolat', { def: contenu.formulaires.benevolat });
    if (r.envoye) return res.redirect(303, '/nous-soutenir?envoye=benevolat#formulaire-benevolat');
    if (r.retryAfterSec) res.set('Retry-After', String(r.retryAfterSec));
    rendreSoutien(res, { etatBenevolat: r.etat }, r.status);
  });

  // Anciennes adresses du refuge.
  router.get('/refuge/benevolat', (req, res) => res.redirect(301, '/nous-soutenir#formulaire-benevolat'));
  router.get('/refuge/don', (req, res) => res.redirect(301, '/nous-soutenir#formulaire-adhesion'));

  // ── Fiches conseils ────────────────────────────────────────────────────────
  router.get('/conseils', (req, res) => {
    res.render('public/conseils', { ...commun, page: contenu.pages.conseils, conseils: contenu.conseils });
  });

  router.get('/conseils/:slug', (req, res, next) => {
    const conseil = contenu.conseil(req.params.slug);
    if (!conseil) return next();
    res.render('public/conseil', { ...commun, conseil });
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
      { loc: '/adopter', priorite: '0.9' },
      { loc: '/nos-missions', priorite: '0.8' },
      { loc: '/famille-accueil', priorite: '0.8' },
      { loc: '/nous-soutenir', priorite: '0.8' },
      { loc: '/conseils', priorite: '0.7' },
      { loc: '/contact', priorite: '0.6' },
      { loc: '/mentions-legales', priorite: '0.2' },
      { loc: '/confidentialite', priorite: '0.2' },
      ...contenu.conseils.map((c) => ({ loc: `/conseils/${c.slug}`, priorite: '0.6' })),
      ...contenu.visibles.map((a) => ({ loc: `/animaux/${a.slug}`, priorite: '0.8' })),
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
