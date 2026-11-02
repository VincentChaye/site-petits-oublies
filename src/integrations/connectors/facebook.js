// Connecteur Facebook. Limite documentée : ~63 206 caractères ; image facultative ;
// texte trop long = erreur (pas de troncature).
import { BaseConnector } from './base.js';

export const SPEC = {
  platform: 'facebook',
  label: 'Facebook',
  enabledVar: 'SOCIAL_FACEBOOK_ENABLED',
  keyVar: 'SOCIAL_FACEBOOK_API_KEY',
  maxChars: 63206,
  requiresImage: false,
  truncate: false,
};

export function creerConnecteur(env) {
  return new BaseConnector(SPEC, env);
}
