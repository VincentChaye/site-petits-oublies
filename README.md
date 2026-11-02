# Refuge des Quatre Vents — site d’adoption (démonstration)

Site vitrine **fictif** d’un refuge animalier, en Node.js + Express + EJS, rendu côté
serveur. Aucune structure, aucun animal, aucune coordonnée et aucun don ne sont réels :
**aucune adoption ni paiement n’a lieu en ligne**, les formulaires déclenchent une simple
mise en relation humaine, et les publications sur les réseaux sociaux sont **simulées**.

## Démarrage

```sh
npm install
cp .env.example .env
# puis remplacez INTERNAL_SECRET par un secret unique :
#   openssl rand -hex 32
npm start           # http://localhost:3000
```

Le serveur **refuse de démarrer** si `INTERNAL_SECRET` est absent, trop court (< 32
caractères) ou laissé à la valeur d’exemple. Les secrets ne sont jamais écrits dans les
journaux ni dans les fichiers de données.

```sh
npm test            # tests unitaires et d'intégration (node:test)
```

## Pages

| Route | Contenu |
|---|---|
| `GET /` | accueil, 4 fiches mises en avant |
| `GET /animaux` | catalogue filtrable (`?espece=&tranche=&taille=`) ; les animaux adoptés sont masqués |
| `GET /animaux/:slug` | fiche détaillée ; chaque consultation est comptée |
| `GET POST /animaux/:slug/interet` | formulaire « cet animal m’intéresse » (fiches disponibles seulement) |
| `GET /refuge` + `POST /refuge/benevolat` `POST /refuge/don` | mission, visites, bénévolat, dons et parrainage |
| `GET POST /contact` | formulaire de contact |
| `GET /mentions-legales` `GET /confidentialite` | pages légales |
| `GET /sitemap.xml` `GET /robots.txt` | référencement (`/interne` exclu) |
| toute autre URL | page 404 en français |

Espace interne, protégé par le secret partagé et interdit à l’indexation :

| Route | Contenu |
|---|---|
| `GET POST /interne/connexion`, `POST /interne/deconnexion` | session (cookie `sid` limité au chemin `/interne`) |
| `GET /interne` | classement des fiches par consultations, alertes sous le seuil |
| `GET /interne/file` + `POST /interne/file/:id/{approuver,modifier,rejeter,reprendre}` | file de validation des publications |
| `GET /interne/calendrier` | envois approuvés, regroupés par jour (heure de Paris) |
| `GET /interne/journal` | journal des tentatives d’envoi, en lecture seule |
| `GET /interne/soumissions` + `GET /interne/soumissions/export.csv` | soumissions des formulaires et export |

## Organisation du code

```
content/        textes éditoriaux et fiches animaux (JSON, source de vérité)
public/         CSS, JS d'amélioration progressive, images, robots.txt
src/security/   configuration, en-têtes, sessions, CSRF, validation, anti-spam, CSV, purge
src/server/     application Express, routes, contenu, compteur de vues, soumissions, stockage
src/integrations/  service de communication sociale et connecteurs (simulation)
src/views/      gabarits EJS (public/ et interne/)
tests/          tests de démarrage et d'intégration des routes
data/           données générées à l'exécution (non suivi par git)
```

## Sécurité et vie privée

- En-têtes sur toutes les réponses : CSP sans `unsafe-inline` (aucun script ni style en
  ligne), `nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`,
  `Permissions-Policy` restrictive, HSTS en production.
- Formulaires publics : champ piège, jeton horodaté signé (HMAC), contrôle de l’origine,
  limitation de débit par IP. **Aucune IP n’est écrite sur disque** (hachée en mémoire
  avec un sel propre au processus).
- Espace interne : comparaison du secret à temps constant, cookie `HttpOnly`,
  `SameSite=Strict`, `Path=/interne` (`Secure` en production), jeton CSRF lié à la session
  sur toutes les écritures. Les routes publiques n’émettent jamais de cookie.
- Données : validation et assainissement de toutes les saisies, échappement à l’affichage,
  écriture atomique des fichiers JSON, export CSV protégé contre l’injection de formules,
  **purge automatique des soumissions de plus de 12 mois** au démarrage.

## Communication sociale (simulation)

Trois déclencheurs (nouvelle arrivée, fiche peu consultée, relance périodique) proposent
des posts pour Facebook, Instagram, X et LinkedIn à partir de `content/posts-templates.json`.
Chaque post passe par la file de validation avant un envoi **simulé** : le mode réel n’est
pas implémenté et `SOCIAL_MODE=reel` est ignoré. Détail des variables, codes d’erreur et
du cycle de vie : [`src/integrations/README-integrations.md`](src/integrations/README-integrations.md).

## Configuration

Toutes les variables sont décrites dans [`.env.example`](.env.example). Les principales :
`INTERNAL_SECRET` (obligatoire), `PORT`, `BASE_URL`, `DATA_DIR`, `NODE_ENV`,
`ATTENTION_THRESHOLD` (seuil de consultations du tableau de bord) et les variables
`SOCIAL_*` des connecteurs.
