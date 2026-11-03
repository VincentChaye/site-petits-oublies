// Lecture tolérante d'une fiche animal (champs FR ou EN).
export function animalVars(animal, env) {
  const id = animal.id ?? animal.slug;
  const base = (env.SOCIAL_SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const p0 = Array.isArray(animal.photos) ? animal.photos[0] : undefined;
  const photo = animal.photo ?? (p0 && typeof p0 === 'object' ? p0.src : p0) ?? animal.image;
  return {
    id,
    nom: animal.nom ?? animal.name ?? 'notre protégé',
    espece: animal.espece ?? animal.species ?? 'animal',
    url: animal.url ?? `${base}/animaux/${encodeURIComponent(id)}`,
    imageUrl: typeof photo === 'string' ? photo : undefined,
  };
}

export function arrivalOf(animal) {
  return animal.arrivalDate ?? animal.dateArrivee;
}

/**
 * Un animal est publiable seulement s'il est adoptable : ni adopté, ni en soins.
 * Un animal en soins reste visible au catalogue mais ne part pas en publication,
 * automatique ou planifiée — l'équipe choisit elle-même quand en parler.
 */
export function isAvailable(animal) {
  const s = String(animal.statut ?? animal.status ?? '').toLowerCase();
  return !['adopte', 'adopté', 'adopted', 'en_soins', 'en soins'].includes(s);
}
