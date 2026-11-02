# Communication sociale — service d’automatisation

> **Aucune publication réelle n’est effectuée ni promise.** Les quatre connecteurs (Facebook, Instagram, X, LinkedIn) fonctionnent en **simulation** ; le mode réel n’est pas implémenté (code `NOT_IMPLEMENTED`). Aucun compte ni clé d’API n’est fourni dans ce projet.

## Scénarios

| Déclencheur | Étapes | Fréquence | En cas d’échec |
|---|---|---|---|
| Nouvelle arrivée (`arrivee`) : `arrivalDate` < `SOCIAL_NEW_ARRIVAL_DAYS` jours | génération d’un post par plateforme activée → `en_validation` | à chaque `scanTriggers` ; une seule fois par animal et plateforme | animal/plateforme ignoré avec raison (`skipped`) |
| Animal peu consulté (`peu_consulte`) : animaux sous le seuil fournis par le tableau de bord | idem | à chaque `scanTriggers` ; pas de doublon tant qu’un post est en file, puis pas avant `SOCIAL_RELANCE_PERIOD_DAYS` | idem |
| Relance périodique (`relance_periodique`) | idem, un seul animal par passage (le moins récemment évoqué) | max. 1 par animal et par `SOCIAL_RELANCE_PERIOD_DAYS` | idem |
| Envoi (`runDue`, planificateur) | `planifie` et `scheduledAt` ≤ maintenant → `publish` du connecteur → `envoye` | toutes les `intervalMs` (`startScheduler`) ; pas de chevauchement (un passage à la fois) | 3 reprises automatiques (délais base, 2×, 4×) puis `echec` ; `retry(id)` pour reprendre à la main |

Cycle d’un post : `en_validation` → (`approve`) `planifie` → `envoye` | `echec` ; `reject` → `rejete` ; `edit` ramène à `en_validation` (historique `history` conservé).

## Variables d’environnement (fichier `.env` non suivi)

| Variable | Défaut | Rôle |
|---|---|---|
| `SOCIAL_FACEBOOK_ENABLED` | `false` | active Facebook |
| `SOCIAL_INSTAGRAM_ENABLED` | `false` | active Instagram (image obligatoire) |
| `SOCIAL_X_ENABLED` | `false` | active X |
| `SOCIAL_LINKEDIN_ENABLED` | `false` | active LinkedIn |
| `SOCIAL_FACEBOOK_API_KEY` | vide | clé Facebook (jamais dans le dépôt) |
| `SOCIAL_INSTAGRAM_API_KEY` | vide | clé Instagram |
| `SOCIAL_X_API_KEY` | vide | clé X |
| `SOCIAL_LINKEDIN_API_KEY` | vide | clé LinkedIn |
| `SOCIAL_MODE` | `simulation` | `simulation` (seul mode fonctionnel) ou `reel` (non implémenté) |
| `SOCIAL_SIMULATE_FAILURE` | vide | nom d’une plateforme (`facebook`, `instagram`, `x`, `linkedin`) dont l’envoi échoue volontairement (démo des reprises) |
| `SOCIAL_NEW_ARRIVAL_DAYS` | `14` | fenêtre « nouvelle arrivée » |
| `SOCIAL_RELANCE_PERIOD_DAYS` | `30` | période minimale entre deux relances d’un animal |
| `SOCIAL_RETRY_BASE_MS` | `60000` | délai de base des reprises (×2 à chaque reprise) |

Variable facultative complémentaire du service : `SOCIAL_SITE_URL` (défaut `http://localhost:3000`) sert à construire le lien `/animaux/<id>` d’un post si la fiche n’a pas d’`url`.

## Codes d’erreur

Connecteurs (remontés dans le journal et `lastError`) : `DISABLED`, `MISSING_CREDENTIALS`, `SIMULATED_FAILURE`, `INVALID_CONTENT`, `IMAGE_REQUIRED`, `NOT_IMPLEMENTED`, `INTERNAL_ERROR`. Succès simulé : `SIMULATED_OK`.
Service : `PLATEFORME_DESACTIVEE`, `ERREUR_INTERNE` (journal) ; exceptions `SocialError.code` : `INTROUVABLE`, `STATUT_INVALIDE`, `TEXTE_INVALIDE`, `DECLENCHEUR_INVALIDE`, `ANIMAL_INVALIDE`, `DATE_INVALIDE`, `CONNECTEURS_ABSENTS`, `CONFIG`.
Raisons de `skipped` : `deja_en_file`, `deja_genere`, `periode_relance`, `gabarit_absent`, `format_invalide`.

## Persistance et journal

`${dataDir}/social/posts.json` (écriture atomique : fichier temporaire + renommage) et `${dataDir}/social/journal.jsonl` (ajout seul) : `{ts, postId, platform, mode, result: 'ok'|'echec', code, message}`. Les valeurs des variables `*_API_KEY`/`TOKEN`/`SECRET` sont masquées (`***`) avant écriture ; aucun secret n’est stocké.

## Gabarits

Lus dans `content/social-templates.json` (format `{ declencheur: { plateforme: "texte {nom} {espece} {url}" } }`). Fichier absent ou invalide → **gabarits de REPLI** (préfixés `[REPLI]`, provisoires, à remplacer par ceux du contenu éditorial). `service.info().templatesSource` indique la source utilisée.

## Activer une plateforme plus tard

1. Renseigner `SOCIAL_<PLATEFORME>_ENABLED=true` et `SOCIAL_<PLATEFORME>_API_KEY` dans `.env`. 2. Sans clé : l’envoi échoue proprement en `MISSING_CREDENTIALS`, sans gêner les autres plateformes. 3. La publication réelle nécessite d’abord une implémentation du mode `reel` dans le connecteur (à la charge de l’intégration) et les accès du client.

## Tests

`node --test src/integrations/__tests__/service.test.js` (répertoire temporaire, horloge et faux connecteur injectés, plus un test avec les connecteurs réels en simulation).
