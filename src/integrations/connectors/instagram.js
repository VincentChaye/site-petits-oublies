// Connecteur Instagram. Légende limitée à 2 200 caractères ; image obligatoire
// (sinon code IMAGE_REQUIRED).
import { BaseConnector } from './base.js';

export const SPEC = {
  platform: 'instagram',
  label: 'Instagram',
  enabledVar: 'SOCIAL_INSTAGRAM_ENABLED',
  keyVar: 'SOCIAL_INSTAGRAM_API_KEY',
  maxChars: 2200,
  requiresImage: true,
  truncate: false,
};

export function creerConnecteur(env) {
  return new BaseConnector(SPEC, env);
}
