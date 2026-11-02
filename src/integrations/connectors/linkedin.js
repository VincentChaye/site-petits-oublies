// Connecteur LinkedIn. Limite documentée : 3 000 caractères ; image facultative.
import { BaseConnector } from './base.js';

export const SPEC = {
  platform: 'linkedin',
  label: 'LinkedIn',
  enabledVar: 'SOCIAL_LINKEDIN_ENABLED',
  keyVar: 'SOCIAL_LINKEDIN_API_KEY',
  maxChars: 3000,
  requiresImage: false,
  truncate: false,
};

export function creerConnecteur(env) {
  return new BaseConnector(SPEC, env);
}
