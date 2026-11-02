// Chargeur de gabarits de posts par plateforme.
// Source officielle attendue : content/social-templates.json (VP produit/design).
// Format supposé : { "<declencheur>": { "<plateforme>": "texte avec {nom} {espece} {url}…" } }
// Si le fichier est absent ou illisible : gabarits de REPLI (non officiels, à remplacer).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const TRIGGERS = ['arrivee', 'peu_consulte', 'relance_periodique'];
export const PLATFORMS = ['facebook', 'instagram', 'x', 'linkedin'];

// REPLI : gabarits minimaux provisoires. Ne pas présenter comme textes validés.
export const REPLI_TEMPLATES = Object.freeze({
  arrivee: {
    facebook: '[REPLI] Nouvelle arrivée au refuge : {nom}, {espece}. Venez le/la rencontrer ! {url}',
    instagram: '[REPLI] Bienvenue à {nom} ({espece}) ! Rencontre sur rendez-vous. {url} #refuge #adoption',
    x: '[REPLI] Nouvelle arrivée : {nom} ({espece}). {url}',
    linkedin: '[REPLI] Le refuge accueille {nom} ({espece}). Contactez-nous pour le/la rencontrer. {url}',
  },
  peu_consulte: {
    facebook: '[REPLI] {nom} ({espece}) attend une famille. Découvrez sa fiche : {url}',
    instagram: '[REPLI] {nom} cherche une famille ! {url} #adoption #refuge',
    x: '[REPLI] {nom} attend une famille : {url}',
    linkedin: '[REPLI] Aidez-nous à faire connaître {nom} ({espece}), en attente d’une famille. {url}',
  },
  relance_periodique: {
    facebook: '[REPLI] Rappel : {nom} ({espece}) est toujours au refuge. {url}',
    instagram: '[REPLI] {nom} est toujours là, prêt(e) à rencontrer sa famille. {url} #adoption',
    x: '[REPLI] {nom} est toujours au refuge : {url}',
    linkedin: '[REPLI] Rappel : {nom} ({espece}) cherche toujours une famille. {url}',
  },
});

function valid(obj) {
  if (!obj || typeof obj !== 'object') return false;
  return TRIGGERS.every((t) => obj[t] && typeof obj[t] === 'object'
    && PLATFORMS.every((p) => typeof obj[t][p] === 'string' && obj[t][p].trim()));
}

/** Charge les gabarits. Retourne { templates, source: 'content'|'REPLI', warning? } */
export function loadTemplates({ contentDir = resolve(process.cwd(), 'content'), file = 'social-templates.json' } = {}) {
  const path = resolve(contentDir, file);
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (valid(parsed)) return { templates: parsed, source: 'content', path };
    return { templates: REPLI_TEMPLATES, source: 'REPLI', warning: `Gabarits invalides dans ${path} : repli utilisé.` };
  } catch {
    return { templates: REPLI_TEMPLATES, source: 'REPLI', warning: `Gabarits absents ou illisibles (${path}) : repli utilisé.` };
  }
}

/** Remplace {cle} par les valeurs ; clés inconnues → chaîne vide. */
export function renderTemplate(tpl, vars) {
  return String(tpl).replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])))
    .replace(/[ \t]{2,}/g, ' ').trim();
}
