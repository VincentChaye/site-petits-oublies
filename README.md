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
npm test            # tests unitaires et d'intégration (node:test) : src/security, src/integrations, tests/
npm run test:e2e    # lance `playwright test` — voir « Tests » plus bas
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
| `GET /sitemap.xml` `GET /robots.txt` | `sitemap.xml` : pages publiques et fiches disponibles (rien de `/interne`). `robots.txt` : fichier statique `public/robots.txt`, qui contient seulement `User-agent: *` et `Disallow: /interne` (pas de ligne `Sitemap:`) |
| toute autre URL | page 404 en français |

Espace interne, protégé par le secret partagé et interdit à l’indexation (`Disallow: /interne` dans `robots.txt`, balise `<meta name="robots" content="noindex, nofollow, noarchive">` dans les pages et en-tête `X-Robots-Tag: noindex` sur toutes les réponses `/interne`) :

| Route | Contenu |
|---|---|
| `GET POST /interne/connexion`, `POST /interne/deconnexion` | session (cookie `sid` limité au chemin `/interne`) |
| `GET /interne` | classement des fiches par consultations, alertes sous le seuil |
| `GET /interne/animaux`, `GET POST /interne/animaux/nouveau`, `GET POST /interne/animaux/:slug/modifier`, `POST /interne/animaux/:slug/statut` | liste, création, modification et bascule disponible/adopté des fiches (champ `_version`, voir plus bas) |
| `GET /interne/file` + `POST /interne/file/:id/{approuver,modifier,rejeter,reprendre}` | file de validation, groupée par réseau (posts « en validation » et « en échec ») |
| `GET /interne/atelier`, `POST /interne/atelier/apercu`, `POST /interne/atelier/deposer` | rédaction manuelle d'un post, aperçu (sans écriture), dépôt dans la file |
| `GET /interne/calendrier` | envois planifiés, envoyés ou en échec, regroupés par jour (heure de Paris) |
| `GET /interne/journal` | journal des tentatives d’envoi (200 dernières entrées), en lecture seule |
| `GET /interne/soumissions[?type=&statut=]`, `POST /interne/soumissions/:id` | soumissions des formulaires, filtre par statut, mise à jour du statut et de la note |
| `GET /interne/soumissions/export.csv[?type=]` | export CSV d'un type de soumission |

Types de soumissions (`?type=`) : `interet` (par défaut), `contact`, `benevolat`, `don_parrainage`.
Toute écriture (`POST`) exige le jeton CSRF de la session.

### Soumissions : statut et note

Chaque soumission porte un **statut** — `nouvelle` (« Nouvelle »), `en_cours` (« En cours »),
`traitee` (« Traitée ») — et une **note** interne de 2 000 caractères maximum. Le filtre
`?statut=` n'accepte que ces trois valeurs (sinon réponse 422 avec message).
`POST /interne/soumissions/:id` ne retient que `statut`, `note` et `filtre` (pour revenir à la
même liste). Le champ `modifieLe` est mis à jour à chaque suivi.

### Champs ajoutés

| Champ | Où | Rôle |
|---|---|---|
| `statut` | soumissions | suivi de la demande (voir ci-dessus) ; `nouvelle` par défaut |
| `note` | soumissions | note interne libre, vide par défaut |
| `animalSlug` | `valeurs` des soumissions « intérêt » | slug de la fiche visée, écrit à l'envoi du formulaire ; sert au décompte des demandes par fiche du tableau de bord |
| `_version` | fiches de `content/animaux.json` | entier valant 1 à la création puis incrémenté à chaque modification ou bascule de statut depuis `/interne/animaux` ; une version périmée est refusée (409). Une fiche sans `_version` est en version 0 |

Au démarrage, une **migration idempotente** donne `statut: nouvelle` et une note vide aux anciennes
soumissions, et déduit `animalSlug` quand le nom de l'animal correspond à une seule fiche.

### Statistiques de consultation (7 / 30 jours)

Le tableau de bord (`/interne`) calcule le total des consultations sur 7 et 30 jours calendaires
(aujourd'hui inclus, jour à l'heure de Paris), en plus du classement par fiche. Les compteurs par
jour sont dans `data/vues-jours.json` (`{"AAAA-MM-JJ": n}`), créé à la première écriture ; seuls
**31 jours** sont conservés. Les totaux par fiche restent dans `data/vues.json`. Les écritures
sont groupées (au plus une toutes les 5 s) et le reste est écrit à l'arrêt propre. Ni cookie ni IP.

### Export CSV

`/interne/soumissions/export.csv?type=<type>` télécharge `soumissions-<type>.csv` (UTF-8 avec BOM,
protégé contre l'injection de formules). Colonnes : `Reçue le`, puis les champs du formulaire du
type choisi (pour `interet`, `Animal concerné` en premier), puis `Statut` (libellé), `Note`,
`Modifiée le`. Un type inconnu retombe sur `interet`. Les libellés des champs viennent de
`content/formulaires.json`.

### Atelier de publication

`/interne/atelier` permet de rédiger un post pour **Instagram ou Facebook** seulement, à propos
d'une fiche **disponible** (une fiche adoptée est refusée). Le formulaire peut être prérempli par
`GET` (`?animal=&reseau=&gabarit=&cadrage=`) depuis `content/posts-templates.json` (gabarits
`arrivee`, `peu_consulte`, `relance_periodique`) avec le bouton « Préremplir avec le gabarit » (étape « 1. Choix de la fiche, du réseau et du gabarit » ; il remplace le texte et les hashtags saisis). « Voir l'aperçu » n'écrit rien ; « Déposer dans la file de validation » crée un post
`en_validation`, visible dans `/interne/file`. L'image et le lien viennent toujours de la fiche.

| Contrôle | Instagram | Facebook |
|---|---|---|
| Texte (hashtags inclus) | 2 200 caractères max | 5 000 caractères max |
| Hashtags | 30 max | 10 max |
| Image | obligatoire (1re photo de la fiche) | facultative |
| Cadrage de l'aperçu | 1:1 (défaut) ou 4:5 | paysage 1,91:1 |
| Aperçu tronqué (« … plus ») | après 125 caractères | après 480 caractères |
| Lien dans l'aperçu | non cliquable | cliquable |

Texte alternatif : 300 caractères max. Hashtag : `#` suivi de lettres, chiffres ou `_`, séparés
par espaces ou virgules, doublons retirés. Le connecteur Facebook déclare une limite plus large
(63 206 caractères), mais l'atelier applique 5 000.

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
Ce fichier (dossier `content/`) est un objet JSON `{ "_variables": [...], "<déclencheur>": { "<réseau>": { "texte": "...", "hashtags": ["#..."] } } }`
(variables `{nom}`, `{espece}`, `{url}`) : 12 gabarits, 3 déclencheurs × 4 réseaux. Si l'un manque ou est vide, le serveur
s'arrête au démarrage ; pour les posts automatiques, les hashtags sont ajoutés à la suite du texte. L'atelier lit les mêmes
gabarits (texte et hashtags séparés), pour Instagram et Facebook seulement. Les scans automatiques ont lieu toutes les 6 h.
L'atelier ajoute des posts déposés à la main. Chaque post passe par la file de validation avant un envoi.

**Heure d'envoi** : dans la file, le champ « Envoi prévu le » est **facultatif** (aide : « Laisser vide
pour un envoi dès que possible »). Vide, l'heure d'envoi est l'instant de l'approbation et l'envoi
part au prochain passage de l'ordonnanceur (toutes les 30 s). Le message de confirmation
« Post approuvé : il part à l'heure prévue (envoi simulé). » s'affiche dans les deux cas : sans date
saisie, « l'heure prévue » désigne donc cet envoi immédiat. Une date saisie est transmise sans fuseau
explicite (le serveur l'interprète dans son propre fuseau), alors que le calendrier affiche l'heure de Paris.

**Reprises** : après un échec d'envoi, le post est retenté automatiquement jusqu'à 3 fois (délais de
base, 2× base puis 4× base ; 60 s, 120 s, 240 s par défaut). La 4ᵉ tentative infructueuse
(1 essai + 3 reprises) passe le post en échec : il apparaît dans la file avec le bouton
« Reprendre l'envoi » (reprise manuelle).

**L'envoi est toujours simulé** : aucune API de réseau social n'est appelée. Le serveur force le
mode `simulation` ; si `SOCIAL_MODE` vaut autre chose (par exemple `reel`), la valeur est
**ignorée** et un avertissement est journalisé. Détail des variables, codes d’erreur et du cycle
de vie : [`src/integrations/README-integrations.md`](src/integrations/README-integrations.md).

## Tests

```sh
npm test            # node --test sur src/security, src/integrations et tests/
npm run test:e2e    # playwright test
```

- `npm test` : 166 tests passaient lors de la rédaction.
- `npm run test:e2e` : **prévu, non disponible**. Le script et les devDependencies Playwright/axe-core
  existent, mais le dépôt ne contient **aucun `playwright.config.*` ni test de bout en bout**.
- **Rapport d'accessibilité** : **prévu, non disponible** (ni rapport, ni test axe exécutable dans le dépôt). `playwright-report/` et `test-results/` sont ignorés par git s'ils sont produits.

## Parcours de démonstration

1. `npm start`, puis `http://localhost:3000/interne/connexion` : saisir `INTERNAL_SECRET` dans le champ « Secret », puis « Se connecter ».
2. Sur le site public, visiter plusieurs fois une fiche (par ex. `/animaux/biscotte`) : chaque
   consultation est comptée (écriture sur disque différée de 5 s).
3. Sur une fiche disponible, ouvrir `/animaux/:slug/interet` et envoyer le formulaire : la demande
   est enregistrée avec `animalSlug`.
4. `/interne` : classement par consultations, totaux 7 et 30 jours, demandes par fiche.
5. Menu « Soumissions » (`/interne/soumissions`) : passer la demande en « En cours » ou « Traitée » et
   ajouter une note (bouton « Enregistrer »), filtrer par statut (« Filtrer »), puis « Exporter en CSV ».
6. Menu « Fiches animaux » (`/interne/animaux`) : « Créer une fiche », modifier une fiche ou la basculer
   avec « Marquer adopté » / « Marquer disponible » (une fiche adoptée est masquée du catalogue public).
7. Menu « Atelier de publication » (`/interne/atelier`) : à l'étape « 1. Choix de la fiche, du réseau et du
   gabarit », choisir une fiche, un réseau (Instagram ou Facebook) et un gabarit (« Texte libre » = aucun), cliquer sur
   « Préremplir avec le gabarit » ; à l'étape « 2. Rédaction », « Voir l'aperçu », puis « Déposer dans la file de validation ».
8. Menu « File de validation » (`/interne/file`) : « Enregistrer la modification », « Approuver »
   (champ facultatif « Envoi prévu le ») ou « Rejeter » le post déposé (ou ceux proposés par les scans).
9. Menus « Calendrier » et « Journal d'envoi » (`/interne/calendrier`, `/interne/journal`) : suivre l'envoi simulé (l'ordonnanceur traite les
   posts planifiés toutes les 30 s). Pour montrer les reprises, démarrer avec
   `SOCIAL_SIMULATE_FAILURE=instagram` (ou un autre réseau), puis, une fois le post en échec, utiliser « Reprendre l'envoi » dans la file.

Les routes de ces étapes existent dans le code ; l'enchaînement complet n'a pas été rejoué à la
main pour cette rédaction (les cas couverts sont dans `tests/server/`).

## Configuration

Toutes les variables sont décrites dans [`.env.example`](.env.example). Aucune autre n'est requise.

| Variable | Rôle réel | Défaut dans le code |
|---|---|---|
| `INTERNAL_SECRET` | secret de l'espace interne (≥ 32 caractères) | aucun : le serveur refuse de démarrer |
| `DATA_DIR` | dossier des données générées (`soumissions.json`, `vues.json`, `vues-jours.json`, `social/`) | `data` |
| `NODE_ENV` | `production` active le cookie `Secure` et HSTS ; toute autre valeur = développement | non défini (= développement) |
| `SOCIAL_MODE` | lu, mais le serveur force `simulation` ; `reel` est ignoré | `simulation` |
| `SOCIAL_RETRY_BASE_MS` | délai de base d'une reprise automatique après échec d'envoi, doublé à chaque tentative | `60000` |
| `PORT`, `BASE_URL` | port d'écoute et URL publique (liens canoniques, sitemap) | `3000`, `http://localhost:<PORT>` |
| `ATTENTION_THRESHOLD` | seuil de consultations sous lequel une fiche est « à surveiller » | `5` |
| autres `SOCIAL_*` | activation par réseau, clés factices, échec simulé, fenêtres de déclenchement | voir `.env.example` et le README des intégrations |

Le code lit aussi `CONTENT_DIR` (dossier des contenus éditoriaux, `content/` par défaut), absent de `.env.example`.

## Ce que le client devra fournir

Ce dépôt est une démonstration. Liste de ce dont une mise en service aurait besoin, **sans
engagement** sur ce qui serait réalisé ni sur les délais :

- les contenus réels du refuge (textes, fiches animaux, photos, mentions légales, coordonnées) ;
- un nom de domaine et un hébergement ; un `INTERNAL_SECRET` propre et la `BASE_URL` publique ;
- les comptes des réseaux sociaux concernés et leurs clés d'API : aujourd'hui seul l'envoi
  simulé existe, le mode réel n'est pas implémenté ;
- les modalités réelles de bénévolat et de dons : le site ne traite aucun paiement.
