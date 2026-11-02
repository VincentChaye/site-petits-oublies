// Connecteur X. Limite de 280 caractères Unicode ; texte tronqué avec ellipse « … ».
import { BaseConnector } from './base.js';

export const SPEC = {
  platform: 'x',
  label: 'X',
  enabledVar: 'SOCIAL_X_ENABLED',
  keyVar: 'SOCIAL_X_API_KEY',
  maxChars: 280,
  requiresImage: false,
  truncate: true,
};

export function creerConnecteur(env) {
  return new BaseConnector(SPEC, env);
}
