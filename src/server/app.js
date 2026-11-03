/**
 * Fabrique de l'application Express (sans écoute réseau).
 * @module server/app
 */
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { securityHeadersMiddleware } from '../security/headers.js';
import { noStoreMiddleware } from '../security/no-store.js';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * @param {{isProduction?: boolean, logger?: {error: Function}, mount?: (app: import('express').Express) => void}} [deps]
 *   mount : point d'injection des routeurs des étapes suivantes.
 * @returns {import('express').Express}
 */
export function createApp(deps = {}) {
  const { isProduction = false, logger = console, mount } = deps;
  const app = express();
  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', path.join(racine, 'src', 'views'));

  app.use(securityHeadersMiddleware({ isProduction }));
  app.use(noStoreMiddleware({ prefixe: '/interne' }));
  app.use(express.static(path.join(racine, 'public')));
  app.use(express.urlencoded({ extended: false, limit: '20kb', parameterLimit: 100 }));

  // ── Point de montage des routeurs (étapes suivantes) ──
  // Ex. : routeur public, formulaires, espace interne. Ils sont montés via `mount`
  // AVANT le gestionnaire d'erreurs ci-dessous.
  if (typeof mount === 'function') mount(app);

  // Gestionnaire d'erreurs : jamais de pile dans la réponse.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err?.type === 'entity.too.large' || err?.type === 'parameters.too.many') return res.status(413).type('text').send('Requête trop volumineuse.');
    if (err?.type === 'entity.parse.failed') return res.status(400).type('text').send('Requête invalide.');
    logger.error(`Erreur serveur : ${err?.name ?? 'Error'}: ${err?.message ?? ''}`);
    if (res.headersSent) return;
    res.status(500).type('text').send('Erreur interne du serveur.');
  });

  return app;
}
