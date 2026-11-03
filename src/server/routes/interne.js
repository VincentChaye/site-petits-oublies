/**
 * Espace interne (/interne) : connexion par secret partagé, tableau de bord,
 * fiches animaux, fiches conseils, besoins et collectes, atelier de publication,
 * file de validation des publications simulées, calendrier, journal et
 * soumissions des formulaires. Seul cet espace émet un cookie de session.
 * @module server/routes/interne
 */
import express from 'express';
import {
  createSessionStore, verifySecret, readSessionToken,
  attachSessionCookie, clearSessionCookieHeader, SESSION_PATH,
} from '../../security/session.js';
import { csrfProtection, csrfTokenFor } from '../../security/csrf.js';
import { verifierMemeOrigine } from '../../security/origine.js';
import { createFailureLimiter } from '../../security/antispam.js';
import { toCsv } from '../../security/csv.js';
import {
  TYPES, STATUTS, LIBELLES_STATUT, NOTE_MAX, statutValide, validerNote, libelleType, colonnesDe,
} from '../soumissions.js';
import { LIBELLES_ESPECE } from '../content.js';
import { monterAnimaux } from './interne-animaux.js';
import { monterAtelier } from './interne-atelier.js';
import { monterConseils } from './interne-conseils.js';
import { monterSoutien } from './interne-soutien.js';

const LIBELLES_PLATEFORME = Object.freeze({ facebook: 'Facebook', instagram: 'Instagram', x: 'X', linkedin: 'LinkedIn' });
const PLATEFORMES = Object.freeze(['facebook', 'instagram', 'x', 'linkedin']);
const TTL_SESSION_MS = 2 * 3600 * 1000;

/** Message unique de connexion refusée : n'indique pas ce qui est faux. */
export const MESSAGE_SECRET_INVALIDE = 'Connexion impossible : secret invalide.';
/** Message générique de blocage (429) : ni durée ni détail. */
export const MESSAGE_BLOCAGE = 'Trop de tentatives. Réessayez plus tard.';

/** Messages de confirmation, choisis par code : jamais de texte libre dans l'URL. */
const MESSAGES = Object.freeze({
  approuve: { type: 'succes', texte: 'Post approuvé : il part à l’heure prévue (envoi simulé).' },
  modifie: { type: 'succes', texte: 'Texte enregistré. Le post repasse en validation.' },
  rejete: { type: 'succes', texte: 'Post rejeté : il ne sera pas envoyé.' },
  repris: { type: 'succes', texte: 'Reprise demandée : un nouvel envoi simulé va être tenté.' },
  suivi: { type: 'succes', texte: 'Suivi de la demande enregistré.' },
  depose: { type: 'succes', texte: 'Publication déposée : elle attend votre validation dans la file.' },
  deconnecte: { type: 'succes', texte: 'Vous êtes déconnecté.' },
  echec: { type: 'erreur', texte: 'Action impossible : le post a changé d’état ou n’existe plus.' },
  invalide: { type: 'erreur', texte: 'Action refusée : vérifiez le texte saisi ou la date d’envoi.' },
});

const messageDe = (req) => MESSAGES[String(req.query.ok ?? req.query.ko ?? '')] ?? null;

/**
 * Construit le routeur de l'espace interne (à monter sur `/interne`).
 * @param {{contenu: any, soumissions: any, vues: any, social: any, secret: string,
 *          seuil?: number, isProduction?: boolean, logger?: {error: Function}}} deps
 * @returns {import('express').Router} Routeur.
 */
export function createInterneRouter({ contenu, soumissions, vues, social, secret, seuil = 5, isProduction = false, logger = console, maxEchecs = 10, fenetreMs = 15 * 60 * 1000 } = {}) {
  if (!contenu || !soumissions || !vues || !social) throw new Error('createInterneRouter : contenu, soumissions, vues et social sont requis.');
  if (typeof secret !== 'string' || !secret) throw new Error('createInterneRouter : secret est requis.');

  const router = express.Router();
  const sessions = createSessionStore({ ttlMs: TTL_SESSION_MS });
  // Ne compte que les échecs : un succès ne consomme pas le quota.
  const limiteurConnexion = createFailureLimiter({ max: maxEchecs, windowMs: fenetreMs });
  /** Journal de sécurité : événement seul, sans secret, IP, cookie ni jeton. */
  const journalSecurite = (evenement) => {
    const f = typeof logger.warn === 'function' ? logger.warn : logger.error;
    f?.call(logger, `[securite] ${evenement}`);
  };
  const csrf = csrfProtection({ secret });


  // ── Connexion ──────────────────────────────────────────────────────────────
  router.get('/connexion', (req, res) => {
    if (sessions.validate(readSessionToken(req.headers.cookie))) return res.redirect(303, SESSION_PATH);
    res.render('interne/connexion', { erreur: null });
  });

  router.post('/connexion', (req, res) => {
    const o = verifierMemeOrigine(req);
    if (!o.ok) {
      journalSecurite(`connexion_origine_refusee (${o.motif})`);
      return res.status(403).render('interne/connexion', { erreur: 'Requête refusée : origine non autorisée.' });
    }
    // La clé (IP) reste en mémoire dans le limiteur (hachée) : jamais journalisée.
    const cle = req.ip ?? 'inconnue';
    const d = limiteurConnexion.status(cle);
    if (d.blocked) {
      journalSecurite('connexion_bloquee');
      res.set('Retry-After', String(d.retryAfterSec));
      return res.status(429).render('interne/connexion', { erreur: MESSAGE_BLOCAGE });
    }
    if (!verifySecret(req.body?.secret, secret)) {
      limiteurConnexion.recordFailure(cle);
      journalSecurite('connexion_echec');
      return res.status(401).render('interne/connexion', { erreur: MESSAGE_SECRET_INVALIDE });
    }
    limiteurConnexion.reset(cle);
    // Régénération : l'éventuel ancien identifiant cessera d'être valide.
    const token = sessions.regenerate(readSessionToken(req.headers.cookie));
    attachSessionCookie({ path: req.baseUrl + req.path }, res, token, { isProduction, maxAgeSec: TTL_SESSION_MS / 1000 });
    res.redirect(303, SESSION_PATH);
  });

  // ── Garde de session : tout le reste exige une session valide ──────────────
  router.use((req, res, next) => {
    const token = readSessionToken(req.headers.cookie);
    if (!token || !sessions.validate(token)) return res.redirect(303, `${SESSION_PATH}/connexion`);
    req.sessionToken = token;
    res.locals.csrfToken = csrfTokenFor(token, secret);
    next();
  });
  router.use(csrf);

  // ── Fiches animaux (liste, création, modification, bascule de statut) ──────
  monterAnimaux(router, { contenu, logger });

  // ── Atelier de publication (dépôt manuel) ──────────────────────────────────
  monterAtelier(router, { contenu, social, logger });

  // ── Fiches conseils (liste, création, modification, suppression) ───────────
  monterConseils(router, { contenu, logger });

  // ── Besoins en matériel et agenda des collectes ────────────────────────────
  monterSoutien(router, { contenu, logger });

  router.post('/deconnexion', (req, res) => {
    sessions.destroy(req.sessionToken);
    res.setHeader('Set-Cookie', clearSessionCookieHeader({ isProduction }));
    res.redirect(303, `${SESSION_PATH}/connexion`);
  });

  // ── Tableau de bord ────────────────────────────────────────────────────────
  router.get('/', async (req, res, next) => {
    try {
    const compteurs = vues.tous();
    // Demandes d'intérêt par fiche (valeurs.animalSlug) ; le reste est « non rattaché » pour garder un total honnête.
    const parSlug = new Map(contenu.animaux.map((a) => [a.slug, 0]));
    let nonRattachees = 0;
    for (const s of await soumissions.lister('interet')) {
      const slug = s.valeurs?.animalSlug;
      if (typeof slug === 'string' && parSlug.has(slug)) parSlug.set(slug, parSlug.get(slug) + 1);
      else nonRattachees += 1;
    }
    const idsDisponibles = new Set(contenu.disponibles.map((a) => a.slug));
    const demandesFichesAdoptees = [...parSlug].filter(([slug]) => !idsDisponibles.has(slug)).reduce((n, [, c]) => n + c, 0);
    const enFile = social.service.list().filter((p) => ['en_validation', 'planifie', 'echec'].includes(p.status));
    const classement = contenu.disponibles
      .map((a) => ({
        slug: a.slug,
        nom: a.nom,
        espece: LIBELLES_ESPECE[a.espece] ?? a.espece,
        consultations: Number(compteurs[a.slug]) || 0,
        demandes: parSlug.get(a.slug) ?? 0,
      }))
      .sort((a, b) => b.consultations - a.consultations || a.nom.localeCompare(b.nom, 'fr'))
      .map((a, i) => ({
        ...a,
        rang: i + 1,
        sousSeuil: a.consultations < seuil,
        relances: enFile
          .filter((p) => p.animalId === a.slug && p.trigger === 'peu_consulte')
          .map((p) => ({ id: p.id, plateforme: LIBELLES_PLATEFORME[p.platform] ?? p.platform, statut: p.status })),
      }));
    res.render('interne/tableau-de-bord', {
      seuil,
      classement,
      vues7: vues.totauxSur(7),
      vues30: vues.totauxSur(30),
      demandesNonRattachees: nonRattachees,
      demandesFichesAdoptees,
      sansDemande: classement.filter((a) => a.demandes === 0).map((a) => ({ slug: a.slug, nom: a.nom })),
      message: messageDe(req),
    });
    } catch (e) { next(e); }
  });

  // ── File de validation ─────────────────────────────────────────────────────
  router.get('/file', (req, res) => {
    const posts = social.service.list();
    const etats = social.service.connectorsStatus();
    // État COURANT de la fiche (jamais en cache) ; une fiche disparue ne fait pas échouer la page.
    const avecFiche = (p) => {
      const f = contenu.animal(p.animalId);
      return { ...p, ficheAdoptee: !!f && f.statut !== 'disponible', ficheIntrouvable: !f };
    };
    const groupes = PLATEFORMES.map((plateforme) => ({
      plateforme,
      libelle: LIBELLES_PLATEFORME[plateforme],
      active: !!etats.find((e) => e.platform === plateforme)?.enabled,
      enValidation: posts.filter((p) => p.platform === plateforme && p.status === 'en_validation').map(avecFiche),
      echecs: posts.filter((p) => p.platform === plateforme && p.status === 'echec').map(avecFiche),
    }));
    res.render('interne/file', { groupes, message: messageDe(req) });
  });

  /** Exécute une action du service sur un post et redirige avec un code de message. */
  function action(nom, executer) {
    return (req, res) => {
      const id = String(req.params.id ?? '');
      try {
        executer(id, req);
        res.redirect(303, `${SESSION_PATH}/file?ok=${nom}${nom === 'rejete' ? '' : `#post-${encodeURIComponent(id)}`}`);
      } catch (e) {
        const code = e?.code === 'TEXTE_INVALIDE' || e?.code === 'DATE_INVALIDE' ? 'invalide' : 'echec';
        logger.error?.(`[interne] action ${nom} refusée : ${e?.code ?? 'ERREUR'} ${e?.message ?? ''}`);
        res.redirect(303, `${SESSION_PATH}/file?ko=${code}`);
      }
    };
  }

  router.post('/file/:id/approuver', action('approuve', (id, req) => {
    const brut = String(req.body?.scheduledAt ?? '').trim();
    social.service.approve(id, brut ? { scheduledAt: brut } : {});
  }));
  router.post('/file/:id/modifier', action('modifie', (id, req) => social.service.edit(id, { text: req.body?.text })));
  router.post('/file/:id/rejeter', action('rejete', (id, req) => social.service.reject(id, { reason: req.body?.reason })));
  router.post('/file/:id/reprendre', action('repris', (id) => social.service.retry(id)));

  // ── Calendrier des envois ──────────────────────────────────────────────────
  router.get('/calendrier', (req, res) => {
    const dateDe = (p) => p.sentAt ?? p.scheduledAt;
    const envois = social.service.list()
      .filter((p) => ['planifie', 'envoye', 'echec'].includes(p.status) && dateDe(p))
      .map((p) => ({
        id: p.id,
        animalName: p.animalName,
        platform: p.platform,
        platformLibelle: LIBELLES_PLATEFORME[p.platform] ?? p.platform,
        status: p.status,
        scheduledAt: dateDe(p),
        text: p.text,
      }))
      .sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)));

    const parJour = new Map();
    const fmtJour = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeZone: 'Europe/Paris' });
    const fmtCle = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Paris' });
    for (const e of envois) {
      const d = new Date(e.scheduledAt);
      if (Number.isNaN(d.getTime())) continue;
      const cle = fmtCle.format(d);
      if (!parJour.has(cle)) parJour.set(cle, { date: cle, libelle: fmtJour.format(d), posts: [] });
      parJour.get(cle).posts.push(e);
    }
    res.render('interne/calendrier', { jours: [...parJour.values()], message: messageDe(req) });
  });

  // ── Journal d'envoi ────────────────────────────────────────────────────────
  router.get('/journal', (req, res) => {
    res.render('interne/journal', { entrees: social.service.getLog({ limit: 200 }), message: messageDe(req) });
  });

  // ── Soumissions des formulaires ────────────────────────────────────────────
  const typeDemande = (req) => (TYPES.includes(String(req.query.type)) ? String(req.query.type) : TYPES[0]);

  const MSG_STATUT_INCONNU = 'Filtre ignoré : statut inconnu. Valeurs possibles : nouvelle, en cours, traitée.';

  /** Filtre ?statut= : '' (aucun), un statut valide, ou null (valeur inconnue). */
  const filtreDemande = (valeur) => {
    if (valeur === undefined || valeur === '') return '';
    return statutValide(valeur) ? valeur : null;
  };

  /** Affiche la liste d'un type, avec filtre éventuel et message. */
  async function rendreSoumissions(res, { type, filtre = '', message = null, status = 200 }) {
    const totaux = await soumissions.compter();
    const toutes = await soumissions.lister(type);
    res.status(status).render('interne/soumissions', {
      types: TYPES.map((cle) => ({ cle, libelle: libelleType(cle), total: totaux[cle] ?? 0 })),
      type,
      colonnes: colonnesDe(type, contenu.formulaires),
      soumissions: filtre ? toutes.filter((s) => s.statut === filtre) : toutes,
      statuts: STATUTS.map((cle) => ({ cle, libelle: LIBELLES_STATUT[cle] })),
      filtre,
      noteMax: NOTE_MAX,
      message,
    });
  }

  router.get('/soumissions', async (req, res, next) => {
    try {
      const type = typeDemande(req);
      const filtre = filtreDemande(req.query.statut);
      if (filtre === null) {
        return await rendreSoumissions(res, { type, status: 422, message: { type: 'erreur', texte: MSG_STATUT_INCONNU } });
      }
      await rendreSoumissions(res, { type, filtre, message: messageDe(req) });
    } catch (e) { next(e); }
  });

  // Mise à jour du suivi : liste blanche des champs (statut, note ; filtre sert à la redirection).
  router.post('/soumissions/:id', async (req, res, next) => {
    try {
      const id = String(req.params.id ?? '');
      const filtre = filtreDemande(typeof req.body?.filtre === 'string' ? req.body.filtre : '') || '';
      const brut = req.body ?? {};
      const maj = {};
      const erreurs = [];
      if (Object.hasOwn(brut, 'statut')) {
        if (statutValide(brut.statut)) maj.statut = brut.statut;
        else erreurs.push('Statut inconnu : choisissez nouvelle, en cours ou traitée.');
      }
      if (Object.hasOwn(brut, 'note')) {
        const n = validerNote(brut.note);
        if (n.ok) maj.note = n.note;
        else erreurs.push(n.message);
      }
      if (!erreurs.length && maj.statut === undefined && maj.note === undefined) erreurs.push('Rien à enregistrer : indiquez un statut ou une note.');

      let existant = null;
      for (const t of TYPES) {
        if ((await soumissions.lister(t)).some((s) => s.id === id)) { existant = t; break; }
      }
      if (!existant) {
        return await rendreSoumissions(res, { type: TYPES[0], filtre, status: 404, message: { type: 'erreur', texte: 'Soumission introuvable.' } });
      }
      if (erreurs.length) {
        return await rendreSoumissions(res, { type: existant, filtre, status: 422, message: { type: 'erreur', texte: erreurs.join(' ') } });
      }
      const r = await soumissions.modifier(id, maj);
      if (!r) {
        return await rendreSoumissions(res, { type: existant, filtre, status: 404, message: { type: 'erreur', texte: 'Soumission introuvable.' } });
      }
      const q = new URLSearchParams({ type: r.type });
      if (filtre) q.set('statut', filtre);
      q.set('ok', 'suivi');
      res.redirect(303, `${SESSION_PATH}/soumissions?${q}#soumission-${encodeURIComponent(id)}`);
    } catch (e) { next(e); }
  });

  router.get('/soumissions/export.csv', async (req, res, next) => {
    try {
    const type = typeDemande(req);
    const colonnes = colonnesDe(type, contenu.formulaires);
    const liste = await soumissions.lister(type);
    const entetes = ['Reçue le', ...colonnes.map((c) => c.libelle), 'Statut', 'Note', 'Modifiée le'];
    const lignes = liste.map((s) => {
      const ligne = { 'Reçue le': s.createdAt };
      for (const c of colonnes) ligne[c.libelle] = s.valeurs?.[c.cle] ?? '';
      ligne.Statut = LIBELLES_STATUT[s.statut] ?? s.statut;
      ligne.Note = s.note;
      ligne['Modifiée le'] = s.modifieLe;
      return ligne;
    });
    res.status(200)
      .type('text/csv; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="soumissions-${type}.csv"`)
      .send(`﻿${toCsv(entetes, lignes)}`);
    } catch (e) { next(e); }
  });

  return router;
}
