/**
 * Espace interne (/interne) : connexion par secret partagé, tableau de bord,
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
import { createRateLimiter } from '../../security/antispam.js';
import { toCsv } from '../../security/csv.js';
import { TYPES, libelleType, colonnesDe } from '../soumissions.js';
import { LIBELLES_ESPECE } from '../content.js';

const LIBELLES_PLATEFORME = Object.freeze({ facebook: 'Facebook', instagram: 'Instagram', x: 'X', linkedin: 'LinkedIn' });
const PLATEFORMES = Object.freeze(['facebook', 'instagram', 'x', 'linkedin']);
const TTL_SESSION_MS = 2 * 3600 * 1000;

/** Messages de confirmation, choisis par code : jamais de texte libre dans l'URL. */
const MESSAGES = Object.freeze({
  approuve: { type: 'succes', texte: 'Post approuvé : il part à l’heure prévue (envoi simulé).' },
  modifie: { type: 'succes', texte: 'Texte enregistré. Le post repasse en validation.' },
  rejete: { type: 'succes', texte: 'Post rejeté : il ne sera pas envoyé.' },
  repris: { type: 'succes', texte: 'Reprise demandée : un nouvel envoi simulé va être tenté.' },
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
export function createInterneRouter({ contenu, soumissions, vues, social, secret, seuil = 5, isProduction = false, logger = console } = {}) {
  if (!contenu || !soumissions || !vues || !social) throw new Error('createInterneRouter : contenu, soumissions, vues et social sont requis.');
  if (typeof secret !== 'string' || !secret) throw new Error('createInterneRouter : secret est requis.');

  const router = express.Router();
  const sessions = createSessionStore({ ttlMs: TTL_SESSION_MS });
  const limiteurConnexion = createRateLimiter({ max: 10, windowMs: 15 * 60 * 1000 });
  const csrf = csrfProtection({ secret });

  const origineValide = (req) => {
    const origin = req.headers.origin;
    if (origin === undefined) return true;
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  };

  // ── Connexion ──────────────────────────────────────────────────────────────
  router.get('/connexion', (req, res) => {
    if (sessions.validate(readSessionToken(req.headers.cookie))) return res.redirect(303, SESSION_PATH);
    res.render('interne/connexion', { erreur: null });
  });

  router.post('/connexion', (req, res) => {
    if (!origineValide(req)) return res.status(403).render('interne/connexion', { erreur: 'Requête refusée : origine non autorisée.' });
    const d = limiteurConnexion.check(req.ip ?? 'inconnue');
    if (!d.allowed) {
      res.set('Retry-After', String(d.retryAfterSec));
      return res.status(429).render('interne/connexion', { erreur: `Trop de tentatives. Réessayez dans ${d.retryAfterSec} seconde(s).` });
    }
    if (!verifySecret(req.body?.secret, secret)) {
      return res.status(401).render('interne/connexion', { erreur: 'Secret incorrect.' });
    }
    const token = sessions.create();
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

  router.post('/deconnexion', (req, res) => {
    sessions.destroy(req.sessionToken);
    res.setHeader('Set-Cookie', clearSessionCookieHeader({ isProduction }));
    res.redirect(303, `${SESSION_PATH}/connexion`);
  });

  // ── Tableau de bord ────────────────────────────────────────────────────────
  router.get('/', (req, res) => {
    const compteurs = vues.tous();
    const enFile = social.service.list().filter((p) => ['en_validation', 'planifie', 'echec'].includes(p.status));
    const classement = contenu.disponibles
      .map((a) => ({
        slug: a.slug,
        nom: a.nom,
        espece: LIBELLES_ESPECE[a.espece] ?? a.espece,
        consultations: Number(compteurs[a.slug]) || 0,
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
    res.render('interne/tableau-de-bord', { seuil, classement, message: messageDe(req) });
  });

  // ── File de validation ─────────────────────────────────────────────────────
  router.get('/file', (req, res) => {
    const posts = social.service.list();
    const etats = social.service.connectorsStatus();
    const groupes = PLATEFORMES.map((plateforme) => ({
      plateforme,
      libelle: LIBELLES_PLATEFORME[plateforme],
      active: !!etats.find((e) => e.platform === plateforme)?.enabled,
      enValidation: posts.filter((p) => p.platform === plateforme && p.status === 'en_validation'),
      echecs: posts.filter((p) => p.platform === plateforme && p.status === 'echec'),
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

  router.get('/soumissions', async (req, res) => {
    const type = typeDemande(req);
    const totaux = await soumissions.compter();
    const liste = await soumissions.lister(type);
    res.render('interne/soumissions', {
      types: TYPES.map((cle) => ({ cle, libelle: libelleType(cle), total: totaux[cle] ?? 0 })),
      type,
      colonnes: colonnesDe(type, contenu.formulaires),
      soumissions: liste,
      message: messageDe(req),
    });
  });

  router.get('/soumissions/export.csv', async (req, res) => {
    const type = typeDemande(req);
    const colonnes = colonnesDe(type, contenu.formulaires);
    const liste = await soumissions.lister(type);
    const entetes = ['Reçue le', ...colonnes.map((c) => c.libelle)];
    const lignes = liste.map((s) => {
      const ligne = { 'Reçue le': s.createdAt };
      for (const c of colonnes) ligne[c.libelle] = s.valeurs?.[c.cle] ?? '';
      return ligne;
    });
    res.status(200)
      .type('text/csv; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="soumissions-${type}.csv"`)
      .send(`﻿${toCsv(entetes, lignes)}`);
  });

  return router;
}
