// Service de communication sociale : génération, file de validation, planification, envoi, journal.
import { randomUUID } from 'node:crypto';
import { createStore } from './store.js';
import { animalVars, arrivalOf, isAvailable } from './animal.js';
import { loadTemplates, renderTemplate, TRIGGERS } from '../templates/index.js';

// Connecteurs de dev-api (interface imposée). Import tolérant : absent => erreur claire à la création
// du service, sauf si `connectors` est injecté.
let defaultCreateConnectors = null;
let connectorsImportError = null;
try {
  ({ createConnectors: defaultCreateConnectors } = await import('../connectors/index.js'));
} catch (e) {
  connectorsImportError = e;
}

const DAY = 86_400_000;
const MAX_AUTO_RETRIES = 3;

export class SocialError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'SocialError';
    this.code = code;
    if (details) this.details = details;
  }
}

const int = (v, d) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : d;
};

export function createSocialService({ dataDir, env = process.env, getAnimals = () => [], now = () => Date.now(), connectors, contentDir, templates } = {}) {
  if (!dataDir) throw new SocialError('CONFIG', 'dataDir est requis.');
  let conns = connectors;
  if (!conns) {
    if (!defaultCreateConnectors) {
      throw new SocialError('CONNECTEURS_ABSENTS', `Connecteurs indisponibles (src/integrations/connectors/index.js) : ${connectorsImportError?.message ?? 'inconnu'}`);
    }
    conns = defaultCreateConnectors({ env });
  }

  const cfg = {
    arrivalDays: int(env.SOCIAL_NEW_ARRIVAL_DAYS, 14),
    relanceDays: int(env.SOCIAL_RELANCE_PERIOD_DAYS, 30),
    retryBaseMs: int(env.SOCIAL_RETRY_BASE_MS, 60_000),
  };
  const tpl = templates ? { templates, source: 'injecte' } : loadTemplates(contentDir ? { contentDir } : {});
  const store = createStore(dataDir);
  const posts = store.posts;

  // Valeurs sensibles à masquer dans tout texte persisté.
  const secrets = Object.entries(env)
    .filter(([k, v]) => /(API_KEY|TOKEN|SECRET|PASSWORD)/i.test(k) && typeof v === 'string' && v.length >= 4)
    .map(([, v]) => v);
  const redact = (s) => secrets.reduce((acc, sec) => acc.split(sec).join('***'), String(s ?? ''));

  const nowMs = () => {
    const v = now();
    return v instanceof Date ? v.getTime() : typeof v === 'number' ? v : new Date(v).getTime();
  };
  const iso = (ms) => new Date(ms).toISOString();
  const toMs = (v, fallback) => {
    if (v == null) return fallback;
    const ms = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : new Date(v).getTime();
    if (!Number.isFinite(ms)) throw new SocialError('DATE_INVALIDE', 'Date de planification invalide.');
    return ms;
  };
  const clone = (p) => structuredClone(p);
  const findPost = (id) => {
    const p = posts.find((x) => x.id === id);
    if (!p) throw new SocialError('INTROUVABLE', `Post introuvable : ${id}`);
    return p;
  };
  const touch = (p, action, extra = {}) => {
    const ts = iso(nowMs());
    p.updatedAt = ts;
    p.history.push({ ts, action, ...extra });
    store.save();
  };

  const enabledPlatforms = () => conns.status().filter((s) => s.enabled).map((s) => s.platform);

  // ---------- génération ----------
  function generate(trigger, animal) {
    const result = { created: [], skipped: [] };
    if (!TRIGGERS.includes(trigger)) throw new SocialError('DECLENCHEUR_INVALIDE', `Déclencheur inconnu : ${trigger}`);
    if (!animal || (animal.id == null && animal.slug == null)) throw new SocialError('ANIMAL_INVALIDE', 'Animal sans identifiant.');
    const vars = animalVars(animal, env);
    const t = nowMs();
    for (const platform of enabledPlatforms()) {
      const skip = (reason, extra = {}) => result.skipped.push({ animalId: vars.id, trigger, platform, reason, ...extra });
      // Dépôts manuels (atelier) : tout trigger confondu, pour ne pas doubler une publication déjà prévue.
      const manuels = posts.filter((p) => p.animalId === vars.id && p.trigger === 'manuel' && p.platform === platform);
      if (manuels.some((p) => p.status === 'en_validation' || p.status === 'planifie')) { skip('deja_en_file'); continue; }
      if (manuels.some((p) => p.status !== 'rejete' && t - Date.parse(p.createdAt) < cfg.relanceDays * DAY)) { skip('depot_manuel_recent'); continue; }
      const same = posts.filter((p) => p.animalId === vars.id && p.trigger === trigger && p.platform === platform);
      if (same.some((p) => p.status === 'en_validation' || p.status === 'planifie')) { skip('deja_en_file'); continue; }
      if (trigger === 'arrivee' && same.length) { skip('deja_genere'); continue; }
      if (trigger !== 'arrivee' && same.some((p) => t - Date.parse(p.createdAt) < cfg.relanceDays * DAY)) { skip('periode_relance'); continue; }
      const raw = tpl.templates[trigger]?.[platform];
      if (!raw) { skip('gabarit_absent'); continue; }
      const connector = conns.get(platform);
      let text = renderTemplate(raw, vars);
      let imageUrl = vars.imageUrl;
      try {
        const f = connector.formatPost({ text, imageUrl, platform, animalId: vars.id, trigger });
        if (!f?.valid) { skip('format_invalide', { errors: f?.errors ?? [] }); continue; }
        text = f.text ?? text;
        imageUrl = f.imageUrl ?? imageUrl;
      } catch (e) { skip('format_invalide', { errors: [redact(e.message)] }); continue; }
      const ts = iso(t);
      const post = {
        id: randomUUID(), animalId: vars.id, animalName: vars.nom, trigger, platform,
        text, imageUrl: imageUrl ?? null, status: 'en_validation',
        scheduledAt: null, createdAt: ts, updatedAt: ts, attempts: 0, nextAttemptAt: null,
        lastError: null, rejectReason: null, templateSource: tpl.source,
        history: [{ ts, action: 'cree', text }],
      };
      posts.push(post);
      result.created.push(clone(post));
    }
    if (result.created.length) store.save();
    return result;
  }

  /**
   * Dépose un post rédigé à la main (atelier) : `en_validation`, trigger 'manuel'.
   * `text` est le texte FINAL (hashtags compris). L'animal adopté est refusé ici même.
   * Le trigger 'manuel' n'est volontairement PAS dans TRIGGERS (réservé aux scans automatiques).
   */
  function deposerManuel({ animal, platform, text, imageUrl, alt, gabarit } = {}) {
    if (!animal || (animal.id == null && animal.slug == null)) throw new SocialError('ANIMAL_INVALIDE', 'Animal sans identifiant.');
    if (!isAvailable(animal)) throw new SocialError('ANIMAL_NON_PUBLIABLE', 'Cet animal n’est pas adoptable (adopté ou en soins) : on ne dépose pas de publication à son sujet.');
    if (typeof text !== 'string' || !text.trim() || text.length > 5000) throw new SocialError('TEXTE_INVALIDE', 'Le texte doit être non vide (5000 caractères max).');
    if (alt != null && (typeof alt !== 'string' || [...alt].length > 300)) throw new SocialError('ALT_INVALIDE', 'Le texte alternatif est limité à 300 caractères.');
    let connector;
    try { connector = conns.get(platform); } catch { connector = null; }
    if (!connector) throw new SocialError('RESEAU_INVALIDE', `Réseau inconnu : ${String(platform)}`);
    const vars = animalVars(animal, env);
    const image = typeof imageUrl === 'string' && imageUrl ? imageUrl : null;
    const f = connector.formatPost({ text, imageUrl: image, platform, animalId: vars.id, trigger: 'manuel' });
    if (!f?.valid) throw new SocialError('TEXTE_INVALIDE', `Publication non valide pour ${platform}.`, f?.errors ?? []);
    const final = f.text ?? text;
    const ts = iso(nowMs());
    const post = {
      id: randomUUID(), animalId: vars.id, animalName: vars.nom, trigger: 'manuel', platform,
      text: final, imageUrl: f.imageUrl ?? image, alt: alt ? alt : null, status: 'en_validation',
      scheduledAt: null, createdAt: ts, updatedAt: ts, attempts: 0, nextAttemptAt: null,
      lastError: null, rejectReason: null, templateSource: 'manuel',
      history: [{ ts, action: 'cree', text: final, ...(gabarit ? { gabarit: String(gabarit) } : {}) }],
    };
    posts.push(post);
    store.save();
    return clone(post);
  }

  function scanTriggers({ belowThreshold = [] } = {}) {
    const total = { created: [], skipped: [] };
    const merge = (r) => { total.created.push(...r.created); total.skipped.push(...r.skipped); };
    const animals = (getAnimals() ?? []).filter(isAvailable);
    const t = nowMs();
    const used = new Set();
    for (const a of animals) {
      const arr = Date.parse(arrivalOf(a));
      if (Number.isFinite(arr) && t - arr >= 0 && t - arr < cfg.arrivalDays * DAY) {
        merge(generate('arrivee', a)); used.add(String(a.id));
      }
    }
    for (const a of belowThreshold) {
      merge(generate('peu_consulte', a)); used.add(String(a.id));
    }
    // Relance périodique : un seul animal par passage, le moins récemment évoqué (évite l'inondation de la file).
    const lastMention = (a) => Math.max(0, ...posts.filter((p) => p.animalId === a.id && p.status !== 'rejete').map((p) => Date.parse(p.createdAt)));
    const candidate = animals
      .filter((a) => !used.has(String(a.id)) && t - lastMention(a) >= cfg.relanceDays * DAY)
      .sort((a, b) => lastMention(a) - lastMention(b))[0];
    if (candidate) merge(generate('relance_periodique', candidate));
    return total;
  }

  // ---------- file de validation ----------
  const list = ({ status } = {}) => posts.filter((p) => !status || p.status === status)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(clone);
  const get = (id) => clone(findPost(id));

  function approve(id, { scheduledAt } = {}) {
    const p = findPost(id);
    if (p.status !== 'en_validation') throw new SocialError('STATUT_INVALIDE', `Approbation impossible depuis le statut « ${p.status} ».`);
    p.status = 'planifie';
    p.scheduledAt = iso(toMs(scheduledAt, nowMs()));
    p.attempts = 0; p.nextAttemptAt = null;
    touch(p, 'approuve', { scheduledAt: p.scheduledAt });
    return clone(p);
  }

  function edit(id, { text } = {}) {
    const p = findPost(id);
    if (!['en_validation', 'planifie', 'echec'].includes(p.status)) throw new SocialError('STATUT_INVALIDE', `Modification impossible depuis le statut « ${p.status} ».`);
    if (typeof text !== 'string' || !text.trim() || text.length > 5000) throw new SocialError('TEXTE_INVALIDE', 'Le texte doit être non vide (5000 caractères max).');
    const f = conns.get(p.platform)?.formatPost?.({ text, imageUrl: p.imageUrl, platform: p.platform, animalId: p.animalId, trigger: p.trigger });
    if (f && !f.valid) throw new SocialError('TEXTE_INVALIDE', `Texte non valide pour ${p.platform}.`, f.errors);
    p.text = f?.text ?? text;
    p.status = 'en_validation'; // toute modification impose une nouvelle validation
    p.scheduledAt = null; p.attempts = 0; p.nextAttemptAt = null;
    touch(p, 'modifie', { text: p.text });
    return clone(p);
  }

  function reject(id, { reason } = {}) {
    const p = findPost(id);
    if (!['en_validation', 'planifie', 'echec'].includes(p.status)) throw new SocialError('STATUT_INVALIDE', `Rejet impossible depuis le statut « ${p.status} ».`);
    p.status = 'rejete';
    p.rejectReason = reason ? String(reason).slice(0, 500) : null;
    p.nextAttemptAt = null;
    touch(p, 'rejete', { reason: p.rejectReason });
    return clone(p);
  }

  function retry(id) {
    const p = findPost(id);
    if (p.status !== 'echec') throw new SocialError('STATUT_INVALIDE', 'Seul un post en échec peut être relancé.');
    p.status = 'planifie';
    p.scheduledAt = iso(nowMs());
    p.attempts = 0; p.nextAttemptAt = null;
    touch(p, 'reprise_manuelle');
    return clone(p);
  }

  // ---------- envoi ----------
  let running = false;
  async function sendOne(p) {
    const connector = conns.get(p.platform);
    const statusEntry = conns.status().find((s) => s.platform === p.platform);
    let res;
    if (!connector || !connector.enabled) {
      res = { ok: false, code: 'PLATEFORME_DESACTIVEE', message: `La plateforme ${p.platform} n’est pas activée.`, simulated: true };
    } else {
      try {
        res = await connector.publish({ id: p.id, platform: p.platform, text: p.text, imageUrl: p.imageUrl, animalId: p.animalId });
      } catch (e) {
        res = { ok: false, code: 'ERREUR_INTERNE', message: `Erreur inattendue du connecteur : ${e?.message ?? e}`, simulated: true };
      }
    }
    const ok = !!res?.ok;
    const code = String(res?.code ?? (ok ? 'OK' : 'ERREUR'));
    const message = redact(res?.message ?? (ok ? 'Publication envoyée.' : 'Échec de publication.'));
    const mode = statusEntry?.mode ?? (res?.simulated ? 'simulation' : 'reel');
    store.appendJournal({ ts: iso(nowMs()), postId: p.id, platform: p.platform, mode, result: ok ? 'ok' : 'echec', code, message });
    p.attempts += 1;
    if (ok) {
      p.status = 'envoye'; p.sentAt = iso(nowMs()); p.nextAttemptAt = null; p.lastError = null;
      touch(p, 'envoye', { code });
    } else {
      p.lastError = { code, message };
      if (p.attempts <= MAX_AUTO_RETRIES) {
        p.nextAttemptAt = iso(nowMs() + cfg.retryBaseMs * 2 ** (p.attempts - 1));
        touch(p, 'echec_tentative', { code, attempt: p.attempts, nextAttemptAt: p.nextAttemptAt });
      } else {
        p.status = 'echec'; p.nextAttemptAt = null;
        touch(p, 'echec_definitif', { code, attempt: p.attempts });
      }
    }
    return { postId: p.id, ok, code };
  }

  async function runDue() {
    if (running) return { processed: [], busy: true };
    running = true;
    const processed = [];
    try {
      const t = nowMs();
      const due = posts.filter((p) => p.status === 'planifie' && Date.parse(p.scheduledAt) <= t
        && (!p.nextAttemptAt || Date.parse(p.nextAttemptAt) <= t));
      for (const p of due) {
        if (p.status !== 'planifie') continue; // modifié/rejeté pendant l'exécution
        processed.push(await sendOne(p));
      }
    } finally { running = false; }
    return { processed, busy: false };
  }

  // ---------- journal, état, planificateur ----------
  const getLog = ({ limit = 100 } = {}) => store.readJournal().reverse().slice(0, Math.max(0, int(limit, 100)));
  const connectorsStatus = () => conns.status();

  let timer = null;
  let lastSchedulerError = null;
  function startScheduler(intervalMs = 30_000) {
    stopScheduler();
    timer = setInterval(() => {
      try {
        runDue().catch((e) => { lastSchedulerError = redact(e?.message); });
      } catch (e) { lastSchedulerError = redact(e?.message); }
    }, Math.max(10, int(intervalMs, 30_000)));
    timer.unref?.();
    return true;
  }
  function stopScheduler() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return {
    generate, scanTriggers, deposerManuel, variablesAnimal: (animal) => animalVars(animal, env), list, get, approve, edit, reject, retry, runDue,
    getLog, connectorsStatus, startScheduler, stopScheduler,
    info: () => ({ templatesSource: tpl.source, templatesWarning: tpl.warning ?? null, config: { ...cfg }, schedulerRunning: !!timer, lastSchedulerError }),
  };
}
