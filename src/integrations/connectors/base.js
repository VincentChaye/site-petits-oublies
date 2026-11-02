// Abstraction unique des connecteurs sociaux : cycle commun
// (état -> mise en forme -> publication). Aucun appel réseau : la publication
// réelle n'est pas implémentée (code NOT_IMPLEMENTED).

const VRAI = new Set(['true', '1']);

export function estActif(valeur) {
  return VRAI.has(String(valeur ?? '').trim().toLowerCase());
}

/** Longueur en caractères Unicode (points de code), pas en unités UTF-16. */
export function longueur(texte) {
  return [...String(texte ?? '')].length;
}

/** Tronque à `max` points de code, avec ellipse « … » comprise dans la limite. */
export function tronquer(texte, max) {
  const car = [...String(texte ?? '')];
  if (car.length <= max) return car.join('');
  return car.slice(0, max - 1).join('').trimEnd() + '…';
}

/** Retire toute occurrence de la clé d'un message (défense en profondeur). */
function masquer(message, cle) {
  const m = String(message ?? '');
  return cle ? m.split(cle).join('[masqué]') : m;
}

export class BaseConnector {
  /**
   * @param {object} spec  { platform, label, enabledVar, keyVar, maxChars, requiresImage, truncate }
   * @param {object} env   variables d'environnement (jamais process.env en dur)
   */
  constructor(spec, env = {}) {
    this.spec = spec;
    this.platform = spec.platform;
    this.label = spec.label;
    this.env = env || {};
    this.enabled = estActif(this.env[spec.enabledVar]);
    this.mode = String(this.env.SOCIAL_MODE ?? '').trim().toLowerCase() === 'reel' ? 'reel' : 'simulation';
    this._key = String(this.env[spec.keyVar] ?? '').trim();
    this.hasCredentials = this._key.length > 0;
  }

  status() {
    let message;
    if (!this.enabled) {
      message = `${this.label} désactivé (${this.spec.enabledVar} non défini à « true »).`;
    } else if (!this.hasCredentials) {
      message = this._messageCle();
    } else if (this.mode === 'reel') {
      message = `${this.label} activé en mode réel : publication réelle non implémentée.`;
    } else {
      message = `${this.label} activé en simulation : aucune publication réelle.`;
    }
    return {
      platform: this.platform,
      enabled: this.enabled,
      mode: this.mode,
      hasCredentials: this.hasCredentials,
      message,
    };
  }

  _messageCle() {
    return `Clé d'API ${this.label} absente : configurez ${this.spec.keyVar} dans .env`;
  }

  /** Mise en forme propre à la plateforme. */
  formatPost(post) {
    const errors = [];
    const brut = String(post?.text ?? '').trim();
    const imageUrl = post?.imageUrl ? String(post.imageUrl) : null;
    let text = brut;
    if (!brut) errors.push('Le texte du post est vide.');
    const max = this.spec.maxChars;
    if (max && longueur(brut) > max) {
      if (this.spec.truncate) text = tronquer(brut, max);
      else errors.push(`Le texte dépasse la limite de ${max} caractères pour ${this.label}.`);
    }
    if (this.spec.requiresImage && !imageUrl) {
      errors.push(`Une image est obligatoire pour publier sur ${this.label}.`);
    }
    return { text, imageUrl, valid: errors.length === 0, errors };
  }

  /** Ne lève jamais. Ordre : DISABLED, MISSING_CREDENTIALS, SIMULATED_FAILURE, validation, mode. */
  async publish(post) {
    try {
      const simulated = this.mode !== 'reel';
      if (!this.enabled) {
        return this._res(false, 'DISABLED', `${this.label} est désactivé : activez-le avec ${this.spec.enabledVar}=true.`, simulated);
      }
      if (!this.hasCredentials) {
        return this._res(false, 'MISSING_CREDENTIALS', this._messageCle(), simulated);
      }
      const forcer = String(this.env.SOCIAL_SIMULATE_FAILURE ?? '').trim().toLowerCase();
      if (forcer && forcer === this.platform) {
        return this._res(false, 'SIMULATED_FAILURE', `Échec simulé demandé pour ${this.label} (SOCIAL_SIMULATE_FAILURE).`, simulated);
      }
      const fmt = this.formatPost(post);
      if (!fmt.valid) {
        const code = this.spec.requiresImage && !fmt.imageUrl ? 'IMAGE_REQUIRED' : 'INVALID_CONTENT';
        return this._res(false, code, fmt.errors.join(' '), simulated);
      }
      if (this.mode === 'reel') {
        return this._res(false, 'NOT_IMPLEMENTED', `Publication réelle non implémentée pour ${this.label} : utilisez le mode simulation (SOCIAL_MODE=simulation).`, false);
      }
      return this._res(true, 'SIMULATED_OK', `Publication simulée sur ${this.label} : rien n'a été envoyé réellement.`, true);
    } catch {
      return this._res(false, 'INTERNAL_ERROR', `Erreur interne du connecteur ${this.label}.`, true);
    }
  }

  _res(ok, code, message, simulated) {
    return { ok, code, message: masquer(message, this._key), simulated };
  }
}
