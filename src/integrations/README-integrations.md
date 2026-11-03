# Communication sociale — service d’automatisation

> **Aucune publication réelle n’est effectuée ni promise.** Les quatre connecteurs (Facebook, Instagram, X, LinkedIn) ne font **aucun appel réseau**. Le serveur force le mode `simulation` : l’envoi est **toujours simulé**, quelle que soit la valeur de `SOCIAL_MODE`. Aucun compte ni clé d’API réels ne sont fournis dans ce projet.

## Vue d’ensemble

- Code : `src/integrations/` (service, connecteurs, gabarits) ; câblage au serveur : `src/server/social.js`.
- Au démarrage (`npm start`), le serveur lance un premier scan, puis un scan **toutes les 6 h**, et un passage d’envoi **toutes les 30 s** (planificateur).
- Tout post généré passe d’abord par une validation humaine dans l’espace interne (voir « File de validation »).

## Scénarios automatiques

| Déclencheur | Condition | Fréquence | Si non généré |
|---|---|---|---|
| `arrivee` | animal non adopté, `dateArrivee` dans le passé et à moins de `SOCIAL_NEW_ARRIVAL_DAYS` jours | à chaque scan ; une seule fois par animal et plateforme | entrée dans `skipped` avec une raison |
| `peu_consulte` | animal non adopté dont le nombre de consultations est **strictement inférieur** à `ATTENTION_THRESHOLD` (défaut 5) | à chaque scan ; pas de doublon tant qu’un post est en file, puis pas avant `SOCIAL_RELANCE_PERIOD_DAYS` | idem |
| `relance_periodique` | un seul animal par scan : le moins récemment évoqué, si sa dernière mention (post non rejeté) date d’au moins `SOCIAL_RELANCE_PERIOD_DAYS` ; un animal déjà traité par un autre déclencheur dans le même scan est exclu | max. 1 animal par scan | idem |

Un post est créé **par plateforme activée** ; les plateformes désactivées sont ignorées à la génération.

Raisons de `skipped` : `deja_en_file`, `deja_genere`, `periode_relance`, `depot_manuel_recent` (un dépôt manuel non rejeté de moins de `SOCIAL_RELANCE_PERIOD_DAYS` jours existe pour cet animal et cette plateforme), `gabarit_absent`, `format_invalide`.

## File de validation (`/interne/file`)

Page de l’espace interne (connexion par `INTERNAL_SECRET`, session de 2 h). Elle affiche, par plateforme, les posts `en_validation` et les posts en `echec`. Actions (formulaires POST) :

| Action | Route | Effet |
|---|---|---|
| Approuver | `POST /interne/file/:id/approuver` | `en_validation` → `planifie` ; `scheduledAt` facultatif (défaut : maintenant) |
| Modifier | `POST /interne/file/:id/modifier` | texte révalidé par le connecteur ; le post revient à `en_validation` |
| Rejeter | `POST /interne/file/:id/rejeter` | → `rejete` (motif facultatif, 500 caractères max) |
| Reprendre | `POST /interne/file/:id/reprendre` | `echec` → `planifie`, compteur de tentatives remis à 0 |

Autres pages liées : `/interne/calendrier` (posts `planifie`, `envoye`, `echec`) et `/interne/journal` (200 dernières entrées). Si une plateforme est désactivée, la file avertit que les posts approuvés échoueront à l’envoi.

## Statuts d’un post

| Statut | Signification | Sorties possibles |
|---|---|---|
| `en_validation` | en attente d’une décision humaine | `approve` → `planifie` ; `edit` (reste) ; `reject` → `rejete` |
| `planifie` | approuvé, envoi dès que `scheduledAt` est atteint | `envoye` ; `edit` → `en_validation` ; `reject` → `rejete` ; en cas d’échec, reprises automatiques puis `echec` |
| `envoye` | envoi **simulé** réussi (`SIMULATED_OK`) | aucune |
| `echec` | échec après les reprises automatiques | `retry` → `planifie` ; `edit` → `en_validation` ; `reject` → `rejete` |
| `rejete` | écarté | aucune |

Chaque changement est ajouté à `history` du post.

### Envoi et reprises

Le planificateur (`runDue`, toutes les 30 s, un passage à la fois) traite les posts `planifie` dont `scheduledAt` est atteint. En cas d’échec d’une tentative, le post reste `planifie` avec `nextAttemptAt`. Le délai vaut `SOCIAL_RETRY_BASE_MS` × 2^(n−1) après la tentative n : **base, 2× base, 4× base** (60 s, 120 s, 240 s par défaut). La 4ᵉ tentative infructueuse (1 essai + 3 reprises) passe le post en `echec`. Comme le planificateur ne s’exécute que toutes les 30 s, l’envoi réel d’une reprise peut survenir jusqu’à 30 s après `nextAttemptAt`.

## Atelier de publication (`/interne/atelier`)

Rédaction manuelle d’un post pour **Instagram ou Facebook uniquement** : aperçu (`POST /interne/atelier/apercu`, sans aucune écriture) puis dépôt (`POST /interne/atelier/deposer`) dans la file de validation (`trigger` = `manuel`, statut `en_validation`). Le formulaire peut être prérempli par un gabarit (`arrivee`, `peu_consulte`, `relance_periodique`). Image et lien viennent toujours de la fiche, jamais du formulaire. Une fiche adoptée est refusée.

Limites de l’atelier, telles que codées (`src/server/routes/interne-atelier.js`) :

| | Instagram | Facebook |
|---|---|---|
| Texte (hashtags compris) | 2 200 caractères (points de code) | 5 000 caractères (`.length`) |
| Hashtags | 30 max. | 10 max. |
| Image | **obligatoire** : première photo de la fiche, sinon refus | facultative |
| Cadrage de l’aperçu | `1:1` (défaut) ou `4:5` | paysage 1,91:1 |
| Coupe « … plus » dans l’aperçu | 125 caractères | 480 caractères |
| Texte alternatif | 300 caractères max. (les deux réseaux) | |

Un hashtag doit être un `#` suivi de lettres, chiffres ou `_`. Si le réseau est désactivé, le dépôt reste possible mais l’envoi échouera (`PLATEFORME_DESACTIVEE`).

### Limites des connecteurs (appliquées à la génération, à la modification et à l’envoi)

| Plateforme | Limite | Dépassement | Image |
|---|---|---|---|
| Facebook | 63 206 caractères | refus (pas de troncature) | facultative |
| Instagram | 2 200 caractères | refus (pas de troncature) | obligatoire (`IMAGE_REQUIRED`) |
| X | 280 caractères | texte **tronqué** avec « … » | facultative |
| LinkedIn | 3 000 caractères | refus (pas de troncature) | facultative |

Pour Facebook, la limite de l’atelier (5 000) est donc plus stricte que celle du connecteur (63 206) ; en revanche `edit` sur `/interne/file` ne vérifie que la limite du connecteur (et 5 000 caractères au plus pour le texte, côté service).

## Variables d’environnement

Fichier `.env` (non suivi par git), chargé au démarrage ; modèle : `.env.example`. Valeurs par défaut **du code** lorsque la variable est absente :

| Variable | Défaut du code | Rôle |
|---|---|---|
| `SOCIAL_FACEBOOK_ENABLED`, `SOCIAL_INSTAGRAM_ENABLED`, `SOCIAL_X_ENABLED`, `SOCIAL_LINKEDIN_ENABLED` | désactivé | active la plateforme si la valeur est `true` ou `1` (casse ignorée) |
| `SOCIAL_FACEBOOK_API_KEY`, `SOCIAL_INSTAGRAM_API_KEY`, `SOCIAL_X_API_KEY`, `SOCIAL_LINKEDIN_API_KEY` | vide | clé de la plateforme ; sans clé, l’envoi échoue en `MISSING_CREDENTIALS`. En simulation, toute valeur non vide suffit (aucune vérification) |
| `SOCIAL_MODE` | `simulation` | **sans effet côté serveur** : toute autre valeur (par ex. `reel`) est ignorée, un avertissement est journalisé et la simulation est forcée |
| `SOCIAL_SIMULATE_FAILURE` | vide | nom d’une plateforme (`facebook`, `instagram`, `x`, `linkedin`) dont l’envoi échoue volontairement (`SIMULATED_FAILURE`) |
| `SOCIAL_NEW_ARRIVAL_DAYS` | `14` | fenêtre « nouvelle arrivée » (entier ≥ 0, sinon défaut) |
| `SOCIAL_RELANCE_PERIOD_DAYS` | `30` | période minimale entre deux posts automatiques d’un même animal et déclencheur, et entre deux relances périodiques |
| `SOCIAL_RETRY_BASE_MS` | `60000` | délai de base des reprises après un échec d’envoi (×2 à chaque reprise) ; ne règle pas la fréquence du planificateur (30 s, fixe) |
| `SOCIAL_SITE_URL` | `http://localhost:3000` | construit le lien `/animaux/<slug>` d’un post si la fiche n’a pas d’`url` |

Variables du serveur utilisées par ce service : `DATA_DIR` (défaut `data`, dossier des données ; le service écrit dans `<DATA_DIR>/social/`) et `ATTENTION_THRESHOLD` (seuil `peu_consulte`). `NODE_ENV=production` n’a pas d’effet sur le service social ; il ajoute l’en-tête HSTS et l’attribut `Secure` du cookie de session interne.

## Codes d’erreur

Connecteurs (journal et `lastError`) : `DISABLED`, `MISSING_CREDENTIALS`, `SIMULATED_FAILURE`, `INVALID_CONTENT`, `IMAGE_REQUIRED`, `NOT_IMPLEMENTED` (le mode `reel` n’est pas atteignable via le serveur), `INTERNAL_ERROR`. Succès simulé : `SIMULATED_OK`.
Service : `PLATEFORME_DESACTIVEE`, `ERREUR_INTERNE` (journal) ; exceptions `SocialError.code` : `INTROUVABLE`, `STATUT_INVALIDE`, `TEXTE_INVALIDE`, `ALT_INVALIDE`, `RESEAU_INVALIDE`, `ANIMAL_ADOPTE`, `DECLENCHEUR_INVALIDE`, `ANIMAL_INVALIDE`, `DATE_INVALIDE`, `CONNECTEURS_ABSENTS`, `CONFIG`.

## Persistance et journal

- `<DATA_DIR>/social/posts.json` : écriture atomique (fichier temporaire puis renommage). Un fichier illisible est renommé en `posts.json.corrompu-<horodatage>` et la file repart vide.
- `<DATA_DIR>/social/journal.jsonl` : ajout seul, une ligne `{ts, postId, platform, mode, result: 'ok'|'echec', code, message}` par tentative d’envoi.
- Les valeurs des variables dont le nom contient `API_KEY`, `TOKEN`, `SECRET` ou `PASSWORD` (4 caractères au moins) sont masquées dans les messages du journal, de `lastError` et des raisons `skipped`.

## Gabarits

Le serveur lit **uniquement** `content/posts-templates.json` (par déclencheur et réseau : `{ texte, hashtags[] }` ; hashtags ajoutés à la suite du texte ; variables `{nom}`, `{espece}`, `{url}`). Il n’y a **pas de repli** : si un des 12 gabarits (3 déclencheurs × 4 réseaux) manque ou est vide, le serveur s’arrête au démarrage avec le message « Automatisation sociale indisponible ». Les gabarits `[REPLI]` et `content/social-templates.json` du module `src/integrations/templates/` ne servent que lorsque le service est utilisé seul (sans `templates` injecté), notamment dans ses tests.

## Ce que le client devra fournir

Rien de ce qui suit n’est inclus, et ce document ne promet aucune mise en production. Pour envisager une publication réelle, il faudrait au minimum :

- **Comptes** : les comptes ou pages du refuge sur chaque plateforme concernée, et une personne autorisée à les administrer.
- **Clés d’API** : les identifiants d’accès de chaque plateforme, à placer dans `.env` (jamais dans le dépôt).
- **Domaine** : l’adresse publique du site, pour `BASE_URL` et `SOCIAL_SITE_URL` (liens des posts).

De plus, le mode réel **n’est pas développé** : les connecteurs renvoient `NOT_IMPLEMENTED` et le serveur force la simulation. L’activer demanderait un développement distinct, dont ni le périmètre ni les conditions (règles et accès des plateformes) ne sont établis ici.

## Tests

- `node --test src/integrations/__tests__/service.test.js` et `connectors.test.js` : service avec répertoire temporaire, horloge et faux connecteur injectés, plus un test avec les vrais connecteurs en simulation.
- `npm test` lance l’ensemble (sécurité, intégrations, `tests/`).
