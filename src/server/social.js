// Câblage du service de communication sociale (src/integrations) dans le serveur.
// Simulation uniquement : aucune publication réelle, aucune clé d'API journalisée.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createSocialService } from '../integrations/index.js';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FICHIER_GABARITS = resolve(RACINE, 'content', 'posts-templates.json');
const DECLENCHEURS = ['arrivee', 'peu_consulte', 'relance_periodique'];
const RESEAUX = ['facebook', 'instagram', 'x', 'linkedin'];

const SCAN_INTERVAL_MS = 6 * 60 * 60 * 1000; // nouveau scan toutes les 6 h
const SEND_INTERVAL_MS = 30_000; // envoi des posts planifiés

/**
 * Convertit content/posts-templates.json ({decl:{reseau:{texte,hashtags[]}}, _variables})
 * vers le format du service ({decl:{reseau:"texte #tag …"}}). Lève si incomplet : pas de repli silencieux.
 */
export function chargerGabarits(fichier = FICHIER_GABARITS) {
  const brut = JSON.parse(readFileSync(fichier, 'utf8'));
  const out = {};
  for (const d of DECLENCHEURS) {
    out[d] = {};
    for (const r of RESEAUX) {
      const g = brut?.[d]?.[r];
      const texte = typeof g === 'string' ? g : g?.texte;
      if (typeof texte !== 'string' || !texte.trim()) throw new Error(`Gabarit manquant : ${d}/${r} (${fichier})`);
      const tags = Array.isArray(g?.hashtags) ? g.hashtags.filter((h) => typeof h === 'string' && h).join(' ') : '';
      out[d][r] = tags ? `${texte.trim()} ${tags}` : texte.trim();
    }
  }
  return out;
}

/**
 * Gabarits de l'atelier : {declencheur:{reseau:{texte, hashtags[]}}} avec texte et hashtags SÉPARÉS.
 * Tolérant : un gabarit absent ou mal formé est simplement omis (l'atelier reste utilisable).
 */
export function chargerGabaritsSepares(fichier = FICHIER_GABARITS) {
  let brut;
  try { brut = JSON.parse(readFileSync(fichier, 'utf8')); } catch { return {}; }
  const out = {};
  for (const d of DECLENCHEURS) {
    out[d] = {};
    for (const r of RESEAUX) {
      const g = brut?.[d]?.[r];
      const texte = typeof g === 'string' ? g : g?.texte;
      if (typeof texte !== 'string' || !texte.trim()) continue;
      out[d][r] = { texte: texte.trim(), hashtags: Array.isArray(g?.hashtags) ? g.hashtags.filter((h) => typeof h === 'string' && h) : [] };
    }
  }
  return out;
}

const msg = (e) => String(e?.message ?? e);

export function createSocialRuntime({ env = process.env, dataDir, logger = console, getAnimaux, getVues, getSeuil, now } = {}) {
  if (!dataDir) throw new Error('createSocialRuntime : dataDir est requis.');
  const log = (niveau, texte, extra) => {
    try { (logger?.[niveau] ?? logger?.log)?.call(logger, `[social] ${texte}`, ...(extra ? [extra] : [])); } catch { /* ne jamais casser sur le journal */ }
  };

  // Simulation forcée, quelle que soit la valeur de SOCIAL_MODE.
  const envSimu = { ...env, SOCIAL_MODE: 'simulation' };
  if (env.SOCIAL_MODE && env.SOCIAL_MODE !== 'simulation') log('warn', 'SOCIAL_MODE ignoré : simulation forcée.');

  const templates = chargerGabarits(); // lève si les vrais gabarits sont inutilisables
  const service = createSocialService({
    dataDir, // le magasin écrit dans ${dataDir}/social/
    env: envSimu,
    templates,
    ...(now ? { now } : {}),
    // Fiche du site → champs du service : id = slug (la route publique est /animaux/:slug).
    getAnimals: () => (getAnimaux?.() ?? []).map((a) => ({
      id: a.slug, slug: a.slug, nom: a.nom, espece: a.espece, statut: a.statut,
      dateArrivee: a.dateArrivee, photos: a.photos,
    })),
  });

  let enScan = false;
  function scan() {
    const res = { ok: true, created: [], skipped: [], errors: [] };
    if (enScan) return { ...res, busy: true };
    enScan = true;
    try {
      const animaux = getAnimaux?.() ?? [];
      const vues = getVues?.() ?? {};
      const seuil = Number(getSeuil?.());
      const sous = Number.isFinite(seuil)
        ? animaux
          .filter((a) => String(a.statut ?? '').toLowerCase() !== 'adopte')
          .filter((a) => (Number(vues[a.slug]) || 0) < seuil)
          .map((a) => ({ id: a.slug, slug: a.slug, nom: a.nom, espece: a.espece, statut: a.statut, dateArrivee: a.dateArrivee, photos: a.photos }))
        : [];
      const r = service.scanTriggers({ belowThreshold: sous });
      res.created = r.created;
      res.skipped = r.skipped;
      log('info', `scan : ${r.created.length} créé(s), ${r.skipped.length} ignoré(s).`);
    } catch (e) {
      res.ok = false;
      res.errors.push(msg(e));
      log('error', `scan en échec : ${msg(e)}`);
    } finally { enScan = false; }
    return res;
  }

  let timerScan = null;
  function start() {
    stop();
    scan();
    service.startScheduler(SEND_INTERVAL_MS);
    timerScan = setInterval(() => { scan(); }, SCAN_INTERVAL_MS);
    timerScan.unref?.();
    log('info', 'planificateur démarré (simulation).');
  }
  function stop() {
    if (timerScan) clearInterval(timerScan);
    timerScan = null;
    service.stopScheduler();
  }

  return { service, scan, start, stop, gabarits: chargerGabaritsSepares() };
}
