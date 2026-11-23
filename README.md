# Les Petits Oubliés — site de l’association

Site de l’association de protection animale **Les Petits Oubliés** (RNA W912014218) :
adoption, familles d’accueil, lutte contre la prolifération féline, adhésions, dons et
collectes. Node.js + Express + EJS, rendu côté serveur, sans dépendance de build.

**Aucune adoption et aucun paiement ne sont conclus en ligne** : les formulaires
enregistrent une demande, l’équipe recontacte la personne. Les publications sur les
réseaux sociaux restent **simulées** (voir « Communication sociale »).

Tout le contenu éditorial — textes des pages, fiches animaux, fiches conseils, besoins en
matériel, agenda des collectes — vit dans `content/` et se modifie depuis l’espace interne
`/interne` ou en éditant les fichiers JSON : **aucune de ces modifications ne demande de
développeur**. Voir « Mode d’emploi pour les bénévoles ».

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

Sept pages au menu principal, plus les fiches animaux, les fiches conseils et les pages légales.

| Route | Contenu |
|---|---|
| `GET /` | accueil : mission, trois appels à l’action, 4 fiches mises en avant |
| `GET /nos-missions` | lutte contre la prolifération féline, accueil des animaux (long terme ou temporaire) |
| `GET /adopter` | catalogue filtrable (`?espece=&tranche=&taille=`) ; les animaux **adoptés** sont masqués, les animaux **en soins** restent affichés avec leur badge |
| `GET /animaux/:slug` | fiche détaillée ; chaque consultation est comptée |
| `GET POST /animaux/:slug/interet` | formulaire « projet d’adoption », ouvert aux fiches `disponible` **et** `en_soins` |
| `GET POST /famille-accueil` | devenir famille d’accueil : prise en charge, garanties, cinq engagements, sociabilisation, familles relais, formulaire de candidature |
| `GET /nous-soutenir` + `POST /nous-soutenir/adhesion` `POST /nous-soutenir/benevolat` | adhésion et don, moyens de règlement, don de matériel, agenda des collectes, bénévolat |
| `GET /conseils`, `GET /conseils/:slug` | index des fiches conseils et fiche détaillée (JSON-LD `Article`) |
| `GET POST /contact` | coordonnées réelles, réseaux sociaux, formulaire de contact |
| `GET /mentions-legales` `GET /confidentialite` | pages légales |
| `GET /sitemap.xml` `GET /robots.txt` | `sitemap.xml` : les sept pages, les fiches conseils et les animaux visibles (rien de `/interne`). `robots.txt` : fichier statique `public/robots.txt`, qui contient seulement `User-agent: *` et `Disallow: /interne` (pas de ligne `Sitemap:`) |
| toute autre URL | page 404 en français |

**Anciennes adresses** (redirections permanentes 301, pour que les liens déjà partagés
continuent de fonctionner) : `/refuge → /nos-missions`, `/animaux → /adopter` (avec les
paramètres de filtre), `/refuge/benevolat` et `/refuge/don → /nous-soutenir`.
Les fiches gardent leur adresse `/animaux/:slug`.

### Statuts d’un animal

| Statut | Libellé affiché | Catalogue `/adopter` | Projet d’adoption | Publication réseaux |
|---|---|---|---|---|
| `disponible` | Adoptable | oui | oui | oui |
| `en_soins` | En soins | oui, avec badge | oui | **non** (l’équipe choisit quand en parler) |
| `adopte` | Adopté | non | non (redirection vers la fiche) | non |

Le catalogue, les filtres et l’accueil utilisent l’index `visibles` (`disponible` + `en_soins`) ;
l’atelier réseaux et les relances automatiques utilisent `disponibles` (`disponible` seul).

Espèces reconnues : `chat`, `chien`, `lapin`, `rongeur`, `oiseau`, `nac`.

Espace interne, protégé par le secret partagé et interdit à l’indexation (`Disallow: /interne` dans `robots.txt`, balise `<meta name="robots" content="noindex, nofollow, noarchive">` dans les pages et en-tête `X-Robots-Tag: noindex` sur toutes les réponses `/interne`) :

| Route | Contenu |
|---|---|
| `GET POST /interne/connexion`, `POST /interne/deconnexion` | session (cookie `sid` limité au chemin `/interne`) |
| `GET /interne` | classement des fiches par consultations, alertes sous le seuil |
| `GET /interne/animaux`, `GET POST /interne/animaux/nouveau`, `GET POST /interne/animaux/:slug/modifier`, `POST /interne/animaux/:slug/statut` | liste, création, modification et **choix du statut** des fiches animaux (`disponible`, `en_soins`, `adopte` ; champ `_version`, voir plus bas) |
| `GET /interne/conseils`, `GET POST /interne/conseils/nouveau`, `GET POST /interne/conseils/:slug/modifier`, `POST /interne/conseils/:slug/supprimer` | fiches conseils : liste, création, modification, suppression (`_version`) |
| `GET /interne/soutien`, `POST /interne/soutien/besoins[/:id/supprimer]`, `POST /interne/soutien/collectes[/:id/supprimer]` | besoins en matériel et agenda des collectes (`_version`) |
| `GET /interne/file` + `POST /interne/file/:id/{approuver,modifier,rejeter,reprendre}` | file de validation, groupée par réseau (posts « en validation » et « en échec ») |
| `GET /interne/atelier`, `POST /interne/atelier/apercu`, `POST /interne/atelier/deposer` | rédaction manuelle d'un post, aperçu (sans écriture), dépôt dans la file |
| `GET /interne/calendrier` | envois planifiés, envoyés ou en échec, regroupés par jour (heure de Paris) |
| `GET /interne/journal` | journal des tentatives d’envoi (200 dernières entrées), en lecture seule |
| `GET /interne/soumissions[?type=&statut=]`, `POST /interne/soumissions/:id` | soumissions des formulaires, filtre par statut, mise à jour du statut et de la note |
| `GET /interne/soumissions/export.csv[?type=]` | export CSV d'un type de soumission |

Types de soumissions (`?type=`) : `interet` (par défaut, « Projets d’adoption »),
`famille_accueil`, `adhesion`, `benevolat`, `contact`, et `don_parrainage` — ce dernier n’est
plus proposé au public, le type reste reconnu pour consulter et exporter les demandes déjà reçues.
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
| `_version` | fiches de `content/animaux.json`, fiches de `content/conseils.json`, objet `content/soutien.json` | entier valant 1 à la création puis incrémenté à chaque écriture depuis `/interne` ; une version périmée est refusée (**409**), de sorte que deux bénévoles qui modifient en même temps ne s’écrasent pas. Une entrée sans `_version` est en version 0 |

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
`content/formulaires.json` : la clé `label` sert au site, et la clé facultative `label_export`
donne un en-tête court aux cases à cocher dont le libellé est une phrase entière
(« Reçu fiscal demandé », « Publication de photos acceptée », « Accord du représentant légal »…).

### Fiches conseils

`content/conseils.json` est un **tableau** de fiches :
`{ slug, titre, resume, icone, outil, sections: [...], _version }`.

Chaque section porte un `type` qui pilote son rendu — c'est ce gabarit réutilisable qui
permet d'ajouter « sociabilisation », « accueil d'un lapin », etc. sans toucher au code :

| `type` | Rendu | Champs |
|---|---|---|
| `texte` | paragraphe, titre facultatif | `titre?`, `texte` |
| `liste` | liste à puces | `titre?`, `elements[]` |
| `conseil` | encadré vert | `titre?`, `texte` |
| `saviez_vous` | encadré bordé | `titre?`, `texte` |
| `probleme` | titre + texte, suivis d'un encadré « Conseil de nombreux experts » | `titre` (obligatoire), `texte`, `conseil?` |
| `chiffres` | 1 à 4 chiffres clés encadrés | `titre?`, `elements[{ libelle, valeur }]` (valeur **texte**), `note?` |
| `barres` | 1 à 12 barres horizontales, repère facultatif en pointillés | `titre?`, `elements[{ libelle, valeur }]` (valeur **nombre**), `unite?`, `max?`, `repere?{ valeur, libelle? }`, `note?` |
| `anneau` | 2 à 6 parts, dessinées au prorata de leur total, avec légende | `titre?`, `elements[{ libelle, valeur }]` (valeur **nombre**), `unite?`, `note?` |

Un `type` inconnu fait **échouer le démarrage** plutôt que d'afficher une page vide ; il
en va de même pour un visuel sans `elements` exploitables.

Les trois visuels sont **calculés et rendus côté serveur**, en SVG : largeurs et arcs
passent par des attributs de géométrie, jamais par un attribut `style` (la CSP interdit
`style-src 'unsafe-inline'`), et les couleurs viennent des variables `--serie-1..4` de
`public/css/main.css`. Conséquences : ils s'affichent **sans JavaScript**, la valeur de
chaque barre ou part est écrite en toutes lettres à côté de sa marque — donc la couleur
ne porte jamais seule l'information et aucune infobulle n'est nécessaire — et les quatre
couleurs de série ont été vérifiées pour rester distinguables en protanopie et en
deutéranopie (écart ΔE ≥ 8), avec un repli en `forced-colors`.
`outil` vaut `""` (aucun) ou `"glucides"` : dans ce dernier cas, et seulement dans ce
cas, la page charge `public/js/conseils.js` et affiche le **calculateur du taux de
glucides** (`100 − protéines − matières grasses − cendres − fibres − humidité`). Le
résultat est annoncé dans une zone `aria-live="polite"` ; sans JavaScript, la formule
reste affichée en clair et les champs de saisie restent masqués.

Aucun HTML n'est accepté dans les champs : le texte est échappé à l'affichage.

### Nous soutenir : paiement, besoins, collectes

`content/soutien.json` : `{ paiement, besoins: [], collectes: [] }`.

- **`paiement`** s'édite dans le fichier. `iban` et `helloasso_url` sont volontairement
  **vides** : tant qu'ils le sont, le site affiche un encadré « À compléter » et n'invente
  aucune coordonnée bancaire ni aucun lien. Le chèque et les espèces, eux, sont décrits.
  Le site ne traite **aucun** paiement et le dit sur la page.
- **`besoins`** et **`collectes`** s'éditent depuis `/interne/soutien`. Une collecte dont
  la date est passée **disparaît automatiquement** du site public ; elle reste visible
  dans l'espace interne, marquée « Passée : masquée du site », jusqu'à sa suppression.

Le formulaire d'**adhésion** accepte trois formules : `adhesion` (20 €),
`adhesion_jeune` (0 à 18 ans, 10 €) et `don_libre` (montant saisi). Deux dépendances sont
vérifiées **côté serveur**, pas seulement en HTML : une adhésion jeune exige le nom, le
prénom et l'accord du représentant légal ; un don libre exige un montant entier en euros.

### Atelier de publication

`/interne/atelier` permet de rédiger un post pour **Instagram ou Facebook** seulement, à propos
d'une fiche **adoptable** (une fiche adoptée ou en soins est refusée). Le formulaire peut être prérempli par
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
content/        contenu éditorial, source de vérité (JSON) :
                pages.json (textes des pages + bloc « association »), formulaires.json,
                animaux.json, conseils.json, soutien.json, posts-templates.json
public/         CSS, JS d'amélioration progressive (menu repliable, validation, calculateur),
                images (img/marque/ : logo, motif de pattes, flyer), robots.txt
src/security/   configuration, en-têtes, sessions, CSRF, provenance, validation, anti-spam, CSV, purge
src/server/     application Express, routes, contenu, compteur de vues, soumissions, stockage
src/integrations/  service de communication sociale et connecteurs (simulation)
src/views/      gabarits EJS (public/ et interne/)
documents_association/  documents fournis par l'association (affiches, flyer, bulletin
                d'adhésion, fiche conseils) et ce qui en a été repris — hors de public/
tests/          tests d'intégration des routes (node:test) et tests/e2e/ (Playwright + axe-core)
data/           données générées à l'exécution (non suivi par git)
```

### Feuilles de style et scripts

`main.css` porte la palette, l'échelle d'espacement (`--esp-1..8`), la gouttière, le
conteneur et **tous les composants partagés** : boutons, champs de formulaire, résumés
d'erreurs, cartes, menu repliable. `interne.css` ne redéfinit aucune couleur et n'ajoute
que ce qui est propre à l'espace interne (tableaux, file de validation, aperçu des
publications). Un composant utilisé des deux côtés appartient à `main.css` : les champs
`number` et `date` y ont été remontés, car le calculateur public des fiches conseils en a
besoin autant que les écrans internes.

`main.js` est chargé par les deux espaces. Il gère le menu repliable et la validation des
formulaires publics ; `interne.js` ne garde que les confirmations avant une action
destructrice. Le palier de repli du menu est porté par l'attribut `data-menu` de la
balise `<nav>` : **599 px** sur le site public (sept entrées), **899 px** dans l'espace
interne (dix entrées plus la déconnexion). Sans JavaScript, le bouton garde son attribut
`hidden` et la liste reste dépliée : aucune entrée n'est perdue.

Deux conventions valent pour les deux espaces :

- **Cibles de 44 px** — un lien isolé dans une liste ou seul dans un paragraphe prend la
  classe `lien-bloc`, ou appartient à une liste `liste-liens` / `contact-liste`. Un lien en
  ligne dans une phrase garde la taille du texte (exception de WCAG 2.5.8).
- **Tableaux de l'espace interne** — sous 900 px, chaque ligne devient une carte : l'en-tête
  de colonne est masqué et l'attribut `data-label` de la cellule s'affiche **au-dessus** de
  la valeur. Toute cellule doit donc porter un `data-label`, sans quoi la carte perd son
  intitulé sur mobile.

## Sécurité et vie privée

- En-têtes sur toutes les réponses : CSP sans `unsafe-inline` (aucun script ni style en
  ligne), `nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`,
  `Permissions-Policy` restrictive, HSTS en production.
- Formulaires publics : champ piège, jeton horodaté signé (HMAC), contrôle de la
  provenance, limitation de débit par IP. **Aucune IP n’est écrite sur disque** (hachée en
  mémoire avec un sel propre au processus).
- Contrôle de provenance (`src/security/origine.js`), commun aux formulaires publics et aux
  écritures internes : `Sec-Fetch-Site` est examiné en premier (seuls `same-origin` et
  `none` passent ; un `cross-site` est refusé même sans en-tête `Origin`), puis à défaut
  `Origin` doit correspondre à `Host`. Une requête sans aucun des deux (client non
  navigateur) reste acceptée, le jeton signé ou le jeton CSRF faisant alors seul foi.
  **Pourquoi deux en-têtes** : parce que le site envoie `Referrer-Policy: no-referrer`,
  Chromium aligne l’en-tête `Origin` des envois de formulaire sur la politique de référent
  et envoie `Origin: null` même pour une soumission de même origine. Un contrôle fondé sur
  `Origin` seul refusait donc, dans un vrai navigateur, la connexion à `/interne`, toutes
  les écritures internes et tous les formulaires publics.
- Espace interne : comparaison du secret à temps constant, cookie `HttpOnly`,
  `SameSite=Strict`, `Path=/interne` (`Secure` en production), jeton CSRF lié à la session
  sur toutes les écritures. Les routes publiques n’émettent jamais de cookie.
- Données : validation et assainissement de toutes les saisies, échappement à l’affichage,
  écriture atomique des fichiers JSON, export CSV protégé contre l’injection de formules,
  **purge automatique des soumissions de plus de 12 mois** au démarrage.
- **RGPD** : chaque formulaire affiche, juste avant son bouton d’envoi, sa finalité, sa base
  légale (le consentement), son destinataire (l’association seule), la durée de conservation
  (12 mois), les droits d’accès, de rectification et d’effacement, et l’adresse de contact.
  Le texte vient de la clé `rgpd` du formulaire dans `content/formulaires.json`, complétée
  par `_rgpd_commun`. Le **consentement au recontact** et l’**autorisation de publication de
  photos** sont deux cases distinctes, jamais pré-cochées : deux finalités, deux cases.
  L’adhésion jeune exige l’accord du représentant légal, rappelé dans la politique de
  confidentialité.

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
npm test                         # node --test sur src/security, src/integrations et tests/
npx playwright install chromium  # une seule fois : télécharge le navigateur de test
npm run test:e2e                 # playwright test (tests/e2e/)
```

- `npm test` : 220 tests unitaires et d'intégration (serveur monté en mémoire, aucun navigateur),
  dont `tests/server/conseils-interne.test.js` et `tests/server/soutien-interne.test.js` pour les
  deux nouveaux écrans (CSRF, `_version` et 409, validation en liste blanche).
- `npm run test:e2e` : 123 tests de bout en bout dans un vrai Chromium, répartis en neuf
  fichiers de `tests/e2e/` :

  | Fichier | Ce qu'il couvre |
  |---|---|
  | `public.spec.js` | les sept pages et les pages hors menu (statut, titre, description, canonique, JSON-LD `NGO`), absence de toute mention de démonstration, logo avec texte de remplacement, redirections 301, absence de défilement horizontal à **320, 768, 1024 et 1600 px**, **menu mobile** (replié, dépliable, `aria-expanded`, et déplié d'office **sans JavaScript**), éléments de marque servis, `robots.txt` / `sitemap.xml` sans `/interne`, aucun lien public vers `/interne`, aucun cookie public |
  | `fiches-animaux.spec.js` | créer une fiche depuis `/interne`, la voir sur `/adopter`, slug en doublon et saisie invalide refusés en français, modification visible côté public, les trois statuts (« en soins » reste au catalogue et accepte un projet d'adoption, « adopté » en sort) |
  | `demandes.spec.js` | projet d'adoption public → `/interne/soumissions`, passage de « nouvelle » à « traitée » avec note, filtre par statut, export CSV (colonnes `Statut`, `Note`, `Modifiée le`, sans injection de formule), comptage sur le tableau de bord |
  | `soutien.spec.js` | adhésion jeune refusée sans représentant légal puis acceptée avec, cases de consentement distinctes et jamais pré-cochées, mention RGPD, marqueur « à compléter » au lieu d'un IBAN inventé, demande retrouvée dans `/interne/soumissions` et dans l'export CSV ; besoins et collectes ajoutés depuis `/interne/soutien`, collecte passée masquée du site |
  | `conseils.spec.js` | index → fiche, fil d'Ariane, rendu des types de section, **visuels** (chiffres clés, barres, anneaux) y compris sans JavaScript, JSON-LD `Article`, **calculateur de glucides** (saisie, résultat, annonce `aria-live`, bornes, formule lisible sans JavaScript) |
  | `atelier.spec.js` | aperçu Instagram (carré 1080×1080, coupe à 125 caractères, lien non cliquable) et Facebook (1200×628, lien cliquable), limite de hashtags, dépôt dans la file puis approbation, refus d'une fiche adoptée |
  | `securite.spec.js` | accès refusé sans session, secret erroné, déconnexion, CSP sans `unsafe-inline`, `no-store` sur `/interne`, aucun style/script en ligne, jeton CSRF exigé, écriture `cross-site` refusée, délai anti-robot |
  | `accessibilite.spec.js` | **axe-core** sur 12 pages publiques et 13 pages internes (WCAG 2.0/2.1 A et AA) : zéro violation `critical` ou `serious` ; menu mobile déplié et calculateur rempli également audités ; lien d'évitement, focus visible, formulaires atteignables au clavier, champ piège hors tabulation |
  | `interface.spec.js` | **mesures faites dans le navigateur**, pas dans le code source : taille des cibles (RGAA 13.1) des liens isolés, champs `number` du calculateur réellement habillés, menu interne replié / `Échap` / sans JavaScript, bandeau dans un point de repère, cellules de tableau sur mobile (étiquette au-dessus, champs à la largeur utile), aperçu de l'atelier recadré au format du réseau, résumé d'erreurs unique et focalisé |

**Isolation** : `tests/e2e/serveur-de-test.js` recopie `content/` et vide `data/` dans `.tmp-e2e/`
avant de démarrer le serveur (`CONTENT_DIR` / `DATA_DIR`), sur le port 3100 et avec un secret de
test. Les tests de bout en bout ne touchent donc **ni `content/` ni `data/`** du dépôt. Ils
s'exécutent en un seul worker, sans parallélisme, car plusieurs parcours écrivent les mêmes
fichiers JSON. `.tmp-e2e/`, `playwright-report/` et `test-results/` sont ignorés par git.

**Rapport d'accessibilité** : produit par `accessibilite.spec.js`. En cas de violation, le message
d'échec liste `impact · règle (n élément(s)) : aide`. Le rapport HTML complet s'obtient avec
`CI=1 npm run test:e2e` (sortie dans `playwright-report/`).

### Ce que couvre l'accessibilité, et ce qu'elle ne couvre pas

`accessibilite.spec.js` vérifie l'absence de violation **axe-core** ; `interface.spec.js`
complète par ce qu'un automate ne voit pas dans le balisage : dimensions calculées, cadrage
des images, repli du menu. Les deux s'exécutent à **320, 360, 768 et 1280 px**.

Quatre liens restent sous 24 px de haut : « file de validation » (atelier, calendrier),
« Conseils » et « Nous soutenir » (écrans internes). Ils sont **en ligne dans une phrase** et
relèvent donc de l'exception explicite de WCAG 2.5.8 / RGAA 13.1 : les agrandir couperait le
texte courant. Les liens isolés dans une liste ou seuls dans un paragraphe, eux, portent la
classe `lien-bloc` ou appartiennent à une liste `liste-liens` / `contact-liste`, qui leur
donnent une cible de 44 px.

Restent hors de portée d'un test automatique, et à vérifier à la main avant une mise en
ligne : la pertinence réelle des textes de remplacement des photos d'animaux (saisis par
l'équipe depuis `/interne/animaux`), la qualité de la lecture par un lecteur d'écran réel
(NVDA, VoiceOver) et la clarté du vocabulaire employé dans les fiches.

## Mode d’emploi pour les bénévoles

Tout se fait depuis `http://localhost:3000/interne/connexion`, avec le secret partagé
(`INTERNAL_SECRET`). Aucune de ces opérations ne demande de redémarrer le serveur : la
modification est en ligne dès l’enregistrement.

### Ajouter un animal

1. Menu **« Fiches animaux » → « Créer une fiche »**.
2. L’**identifiant (slug)** est définitif : il sert d’adresse (`/animaux/mon-slug`).
   Lettres minuscules sans accent, chiffres et tirets.
3. Remplir nom, espèce, race, âge, tranche d’âge, taille, sexe, date d’arrivée, statut,
   caractère, besoins et histoire. Tous ces champs sont obligatoires.
4. **Photo** : déposer d’abord le fichier dans `public/img/animaux/`, puis saisir son
   chemin (`/img/animaux/mon-animal-1.jpg`) et une **description** de l’image — elle est
   lue par les personnes qui n’en voient pas le contenu.
5. **Changer le statut** plus tard : dans la liste, choisir « Adoptable », « En soins » ou
   « Adopté » puis « Enregistrer le statut ». Un animal en soins reste visible au catalogue
   avec son badge ; un animal adopté quitte le site.

### Ajouter une fiche conseil

1. Menu **« Fiches conseils » → « Créer une fiche »**.
2. Identifiant, titre et **résumé** (le résumé s’affiche sur la liste et dans les moteurs
   de recherche).
3. **Sections** : une par bloc, les blocs séparés par une ligne contenant seulement `---`.
   La première ligne d’un bloc donne le type, puis le titre après deux points. Le dépliant
   « Comment écrire les sections » du formulaire montre un exemple complet. Types :
   `texte`, `liste`, `conseil`, `saviez_vous`, `probleme`, et les trois visuels
   `chiffres`, `barres`, `anneau` (voir « Fiches conseils »). Dans un visuel, chaque
   donnée s’écrit `- libellé | valeur`, et les lignes `unite :`, `max :`, `repere :`,
   `note :` règlent l’échelle et les légendes.
4. **Outil interactif** : laisser « Aucun », sauf pour une fiche d’alimentation féline où
   « Calculateur du taux de glucides » ajoute l’outil de calcul.
5. Enregistrer : la fiche est aussitôt en ligne sur `/conseils`, et dans le `sitemap.xml`.

### Ajouter une collecte ou un besoin en matériel

1. Menu **« Besoins et collectes »**.
2. **Besoin** : un titre (« Croquettes ») et un détail facultatif. Il s’affiche aussitôt
   dans « Don de matériel » sur `/nous-soutenir`.
3. **Collecte** : date, lieu (nom du magasin), ville, horaires et détail facultatifs.
   Une fois la date passée, la collecte **disparaît d’elle-même** du site public ; elle
   reste dans cette liste, marquée « Passée : masquée du site », jusqu’à sa suppression.
4. Si quelqu’un d’autre a modifié la page entre-temps, l’enregistrement est refusé avec un
   message : recharger la page, puis recommencer. Rien n’est écrasé en silence.

### Suivre les demandes reçues

Menu **« Demandes »** : un onglet par type (projets d’adoption, candidatures famille
d’accueil, adhésions et dons, bénévolat, messages). Pour chaque demande : passer le statut
à « En cours » ou « Traitée », ajouter une note interne, puis « Enregistrer ». Le bouton
« Exporter en CSV » télécharge l’onglet courant, ouvrable dans un tableur.

Les demandes sont **supprimées automatiquement au bout de 12 mois**, avec leurs notes.

### Modifier les textes des pages

Les textes vivent dans `content/pages.json` (un bloc par page, plus un bloc `association`
qui porte le nom, le téléphone, le courriel, le RNA, le SIRET, les adresses et les liens
des réseaux). `content/formulaires.json` porte les libellés, les aides, les messages
d’erreur et les mentions RGPD. Ce sont des fichiers texte : les modifier demande de
relancer le serveur, et une page incomplète le fait **échouer au démarrage** plutôt que
de s’afficher vide.

## Reste à compléter

Ces valeurs sont volontairement vides dans le dépôt, faute d’avoir été fournies. Tant
qu’elles le sont, le site affiche un encadré « À compléter » et n’invente rien :

| Où | Quoi |
|---|---|
| `content/soutien.json` → `paiement.iban` | IBAN de l’association (il figure sur le bulletin d’adhésion papier) |
| `content/soutien.json` → `paiement.helloasso_url` | adresse de la page HelloAsso |
| `content/pages.json` → `association.reseaux[].url` | adresses Facebook, Instagram et album photo |
| `content/pages.json` → `mentions_legales` | nom, adresse et téléphone de l’hébergeur, à la mise en ligne |
| `content/animaux.json` | les fiches livrées sont des exemples à remplacer par les vrais animaux, depuis `/interne/animaux` |
| `public/img/animaux/` | les illustrations SVG livrées remplacent des photos qui n’ont pas été fournies |

## Parcours à rejouer avant une mise en service

1. **Mobile d’abord** : afficher le site à 320 px de large, dérouler le menu, parcourir les
   sept pages — aucun défilement horizontal, aucune cible de clic sous 44 px. Faire de même
   sur `/interne` : le menu des dix entrées doit rester replié derrière le bouton « Menu »
   jusqu’à 900 px, et les tableaux s’afficher en cartes, intitulé au-dessus de la valeur.
2. **Adopter** : un animal « en soins » apparaît au catalogue avec son badge, et son
   formulaire « projet d’adoption » s’ouvre et s’envoie.
3. **Famille d’accueil** : envoyer une candidature, la retrouver dans
   `/interne/soumissions?type=famille_accueil`, la passer en « Traitée » avec une note,
   l’exporter en CSV.
4. **Nous soutenir** : envoyer une adhésion jeune **sans** représentant légal → refus en
   français ; avec représentant légal → acceptée ; vérifier les cases « reçu fiscal » et
   « photos » dans l’export CSV ; vérifier que l’IBAN et le lien HelloAsso affichent bien
   un marqueur « à compléter ».
5. **Conseils** : créer une seconde fiche depuis `/interne/conseils` et la voir apparaître
   sur `/conseils` sans redémarrage ; sur la fiche alimentation, saisir 32 / 12 / 7 / 3 / 10
   dans le calculateur → 36 % de glucides annoncés ; désactiver JavaScript → la formule
   reste lisible.
6. **Sécurité et vie privée** : aucun cookie sur les pages publiques, aucun script ni style
   en ligne, jeton CSRF exigé sur les écritures internes, mention RGPD sous chaque formulaire.

Pour la communication sociale (atelier, file de validation, calendrier, journal), voir
« Communication sociale » plus haut : l’envoi reste simulé.

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

## Hors périmètre

- **Paiement en ligne traité par le site** : il reste chez HelloAsso. Le site enregistre une
  demande et affiche les moyens de règlement ; il ne débite rien et ne demande aucune
  coordonnée bancaire.
- **Publication réelle sur Facebook ou Instagram** : l'atelier reste en simulation. Le mode
  réel demanderait des comptes développeur et des clés d'API.
- **Déploiement et nom de domaine** : l'application tourne en local et reste prête à
  déployer. Point à arbitrer avant la mise en service : un hébergement gratuit met le
  serveur en veille et **efface les fichiers de `data/` à chaque redéploiement** s'il n'y a
  pas de disque persistant — les demandes reçues seraient perdues.
- **Intégration des photos réelles** : les illustrations SVG livrées sont des exemples. Les
  photos de l'association se déposent dans `public/img/animaux/`, puis se rattachent aux
  fiches depuis `/interne/animaux`.
