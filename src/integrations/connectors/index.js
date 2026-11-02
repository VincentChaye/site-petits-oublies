// Point d'entrée : crée les 4 connecteurs depuis un objet env (jamais de lecture globale).
import { creerConnecteur as facebook } from './facebook.js';
import { creerConnecteur as instagram } from './instagram.js';
import { creerConnecteur as x } from './x.js';
import { creerConnecteur as linkedin } from './linkedin.js';

const FABRIQUES = { facebook, instagram, x, linkedin };

export function createConnectors({ env = {} } = {}) {
  const platforms = ['facebook', 'instagram', 'x', 'linkedin'];
  const connecteurs = Object.fromEntries(platforms.map((p) => [p, FABRIQUES[p](env)]));
  return {
    platforms,
    get(platform) {
      return connecteurs[platform] ?? null;
    },
    status() {
      return platforms.map((p) => connecteurs[p].status());
    },
  };
}
