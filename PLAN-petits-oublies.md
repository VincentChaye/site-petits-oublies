# Site « Les Petits Oubliés » — transformation du site existant

## Contexte

L'association **Les Petits Oubliés** (animaux errants, abandonnés ou maltraités) travaille
aujourd'hui avec des PDF et des bulletins Word/Excel remplis à la main, et renvoie son public
vers Facebook et Instagram. Elle veut un site qui fasse gagner du temps aux bénévoles,
qu'elles puissent mettre à jour seules, pour un coût minimal ou nul.

Un site existe déjà dans ce dépôt : `site_adoption`, Node.js + Express + EJS, écrit pour un
refuge **fictif** (« Refuge des Quatre Vents »). Il contient déjà, et c'est ce qui justifie de
le garder plutôt que de repartir de zéro :

- un catalogue d'animaux filtrable, des fiches détaillées, un formulaire « cet animal
  m'intéresse » ;
- un **espace interne `/interne`** (connexion par secret partagé) : création et modification
  des fiches animaux, suivi des demandes avec statut et note, export CSV, atelier de
  publication réseaux sociaux, statistiques de consultation ;
- une base de sécurité sérieuse : CSP sans `unsafe-inline`, CSRF, contrôle de provenance,
  anti-spam (champ piège + jeton signé + limitation de débit), aucune IP sur disque, purge
  automatique des soumissions de plus de 12 mois ;
- 193 tests unitaires et d'intégration + 61 tests Playwright dont un contrôle axe-core
  (zéro violation `critical`/`serious`) et l'absence de défilement horizontal à 320, 768,
  1024 et 1600 px.

**Résultat attendu** : le même socle, mais devenu le site réel de l'association — identité
beige / vert / marron avec motif de pattes, sept pages publiques dont quatre nouvelles
(Nos missions, Famille d'accueil, Nous soutenir, Fiches conseils), des formulaires qui
remplacent les PDF, et tout le contenu modifiable depuis `/interne` sans développeur.

**Décisions actées avec vous** : pile A (garder Express + EJS) ; galerie d'animaux éditable
(version complète) ; adhésion et don = formulaire interne **plus** bouton HelloAsso ; IBAN et
URL HelloAsso laissés en emplacements « à compléter » dans le contenu ; vous fournissez logo,
flyer et photos.

---

## Préalables

1. **Committer l'état actuel** du dépôt `site_adoption` avant toute modification : `git status`
   montre 16 fichiers modifiés et 11 non suivis (durcissement sécurité, atelier, tests e2e).
   Le travail décrit ici part de cet état comme base de référence.
2. **Déposer les éléments graphiques** dans `public/img/marque/` : logo (SVG de préférence,
   sinon PNG), flyer de référence pour la palette, photos d'animaux. Le flyer sert à relever
   les couleurs exactes ; les photos remplacent les illustrations SVG de démonstration.

---

## Travaux

### Lot 1 — Identité et socle

- `public/css/main.css` et `public/css/interne.css` : nouvelle palette dans `:root`
  (beige de fond, vert et marron pour les accents), relevée sur le flyer. Chaque couple
  texte/fond doit rester au-dessus de 4,5:1 — l'en-tête de commentaire du fichier documente
  déjà les ratios calculés, elle est à recalculer de la même façon.
- Motif de pattes : un SVG unique dans `public/img/marque/pattes.svg`, utilisé en
  `background-image` répété et discret sur les bandes de section (jamais derrière du texte long).
- `src/views/public/partials/debut.ejs` :
  - remplacer le texte de marque par le logo (`<img>` avec `alt="Les Petits Oubliés"`) ;
  - **supprimer le bandeau `.bandeau-demo`** et sa règle CSS ;
  - passer la navigation à sept entrées : Accueil, Nos missions, Adopter, Famille d'accueil,
    Nous soutenir, Conseils, Contact ;
  - mettre à jour le JSON-LD `Organization` (nom réel, `@type: NGO`, téléphone, e-mail,
    `sameAs` Facebook et Instagram).
- **Menu mobile** : sept entrées ne tiennent plus sur 320 px. Ajouter un bouton
  « Menu » (`aria-expanded`, `aria-controls`) piloté par `public/js/main.js` (fichier externe,
  la CSP interdit tout script en ligne), avec une liste repliée en CSS en dessous de 600 px et
  déployée au-delà. Sans JavaScript, la liste doit rester visible et utilisable — c'est ce que
  vérifie le test de défilement horizontal de `tests/e2e/public.spec.js`.
- `public/favicon.svg` : nouveau favicon aux couleurs de l'association.

### Lot 2 — Contenus éditoriaux et pages existantes

Tout le texte vit dans `content/pages.json`, lu par `chargerContenu()`
(`src/server/content.js`). Ajouter les clés `nos_missions`, `famille_accueil`, `soutenir`,
`conseils` et les inscrire dans la boucle de vérification au démarrage (ligne 68 : la liste
`['accueil', 'animaux', …]`), pour qu'une page incomplète fasse échouer le démarrage plutôt
que de s'afficher vide.

- **Accueil** (`src/views/public/accueil.ejs`) : mission réelle (chats, chiens, lapins,
  rongeurs, oiseaux, NAC), trois appels à l'action vers Adopter / Famille d'accueil /
  Nous soutenir, et les animaux mis en avant.
- **Nos missions** : nouvelle page `/nos-missions`, vue `src/views/public/nos-missions.ejs`,
  deux sections — lutte contre la prolifération féline (stérilisation et identification des
  chats libres) et accueil des animaux, à long terme ou temporaire. La route `/refuge`
  existante est remplacée ; garder une redirection 301 `/refuge → /nos-missions`.
- **Contact** : vrais coordonnées dans `content/pages.json` (06 20 79 27 08,
  contactlespetitsoublies@gmail.com, liens Facebook et Instagram), formulaire conservé.
- **Mentions légales** : siège social à Morsang-sur-Orge, adresse administrative à
  Perpezac-le-Noir, RNA W912014218, SIRET 90331637000019. Retirer tous les avertissements
  « page fictive ».
- Purger la mention « démo / fictif » de l'ensemble du contenu, des titres et des metas :
  `grep -rn "démo\|fictif\|Quatre Vents" content/ src/ public/` doit ne plus rien renvoyer.

### Lot 3 — Adopter (galerie éditable)

- **Troisième statut.** `src/server/animaux-validation.js` : `STATUTS` passe à
  `{ disponible: 'Adoptable', en_soins: 'En soins', adopte: 'Adopté' }`.
  - `src/server/content.js` : `disponibles` reste le filtre `statut === 'disponible'` (il
    alimente l'atelier réseaux et le sitemap) ; ajouter un index `visibles` = `disponible` +
    `en_soins`, utilisé par le catalogue public, les filtres et l'accueil.
  - `src/server/routes/interne-animaux.js` ligne 141 : la bascule binaire devient un choix
    explicite du statut cible, validé contre `STATUTS` (et toujours protégé par `_version`,
    qui renvoie 409 sur une version périmée).
  - `src/integrations/service/animal.js` et `src/server/social.js` excluent déjà `adopte` :
    vérifier qu'un animal `en_soins` ne part pas en publication automatique.
- **Espèces** : `LIBELLES_ESPECE` et `ORDRE.espece` (`src/server/content.js`, lignes 16 et 22)
  accueillent `rongeur`, `oiseau`, `nac` en plus de `chien`, `chat`, `lapin`.
- **Carte animal** (`src/views/public/partials/carte-animal.ejs`) : badge de statut lisible
  (texte, pas seulement une couleur).
- `/animaux` devient `/adopter` (redirection 301 depuis `/animaux` et `/animaux/:slug`, ou
  conservation des deux chemins — à trancher à l'écriture, le plus simple est de garder
  `/animaux/:slug` pour les fiches et de monter `/adopter` comme catalogue).
- Texte rappelant qu'un animal **en soins** peut déjà correspondre, et formulaire renommé
  « projet d'adoption » : `src/views/public/interet.ejs`, ouvert aux statuts `disponible` et
  `en_soins` (aujourd'hui `routes/public.js` lignes 130 et 139 redirigent tout statut autre
  que `disponible`).
- Bloc de liens vers Facebook, Instagram et l'album photo. **Pas d'iframe** : intégrer les
  publications obligerait à élargir la CSP (`frame-src`) et à charger des traceurs tiers.

### Lot 4 — Devenir famille d'accueil

- Page `/famille-accueil`, vue `src/views/public/famille-accueil.ejs`, contenu repris des
  affiches : prise en charge des frais vétérinaires, nourriture, litière et matériel ; animaux
  stérilisés, vaccinés, identifiés ; priorité à l'adoption ; garde possible ailleurs pendant
  les vacances ; les **5 engagements** ; explication de la sociabilisation ; appel aux
  **familles relais**.
- Nouveau formulaire `famille_accueil` dans `FORM_SCHEMAS` (`src/security/validation.js`) :
  nom, prénom, e-mail, téléphone, adresse, type de logement, présence d'autres animaux,
  disponibilité, espèces souhaitées, acceptation des 5 engagements (case `consent`),
  consentement de recontact. Libellés, aides et messages d'erreur dans
  `content/formulaires.json` — c'est de là que viennent aussi les en-têtes de l'export CSV.
- Routes `GET`/`POST /famille-accueil` dans `src/server/routes/public.js`, en réutilisant
  `traiter()` (lignes 67-89) : anti-spam, validation, enregistrement, redirection 303 et
  ancre de confirmation, exactement comme `/refuge/benevolat`.
- Type de soumission ajouté au filtre et à l'export de `/interne/soumissions`.

### Lot 5 — Nous soutenir

- Page `/nous-soutenir`, vue `src/views/public/soutenir.ejs`, quatre blocs :
  1. **Adhésion et don** : adhésion 20 €, adhésion jeune (0–18 ans) 10 €, don libre.
     Nouveau formulaire `adhesion` : nom, prénom, adresse, téléphone, e-mail, formule
     (`enum` : `adhesion`, `adhesion_jeune`, `don_libre`), montant pour le don libre,
     case « souhaite un reçu fiscal », case « accepte la publication de photos », et pour un
     mineur les nom, prénom et accord du **représentant légal**.
     La dépendance « formule = adhesion_jeune ⇒ représentant légal obligatoire » passe par le
     paramètre `valider` de `traiter()` (déjà utilisé pour l'animal à parrainer,
     `routes/public.js` ligne 175) : c'est une validation serveur, pas seulement un attribut
     HTML.
  2. **Paiement** : IBAN, chèque, espèces — valeurs dans `content/soutien.json` avec un
     marqueur « à compléter » explicite — et bouton HelloAsso vers une URL également à
     compléter. Le site ne traite aucun paiement et le dit.
  3. **Don de matériel** : liste des besoins (pâtées, croquettes, litière, chanvre, foin,
     graines, jouets, couchages, produits d'entretien…), éditable.
  4. **Agenda des collectes** : liste date / lieu / ville / horaires, éditable, les collectes
     passées masquées automatiquement.
- Le formulaire **bénévolat** existant (`FORM_SCHEMAS.benevolat`, déjà complet) est déplacé
  ici depuis `/refuge`. Le formulaire public `don_parrainage` disparaît du site ; le type reste
  reconnu par `/interne/soumissions` et l'export, pour les demandes déjà enregistrées.
- Nouveau contenu `content/soutien.json` (`{ paiement, besoins: [], collectes: [] }`), vérifié
  au démarrage comme `pages.json`.
- Nouvel écran `/interne/soutien` (route `src/server/routes/interne-soutien.js`) pour éditer
  besoins et collectes : même moule que `src/server/routes/interne-animaux.js` — CSRF,
  `store.update()` atomique, champ `_version` et refus 409 d'une version périmée, validation
  en liste blanche dans un module dédié. Entrée ajoutée au menu de
  `src/views/interne/partials/debut.ejs`.

### Lot 6 — Fiches conseils

- Nouveau contenu `content/conseils.json` : tableau de fiches
  `{ slug, titre, resume, icone, sections: [...], outil, _version }`, où chaque section porte
  un `type` parmi `texte`, `liste`, `conseil` (bloc coloré), `saviez_vous` (encadré), `probleme`
  (problème + conseil associé). Le rendu est piloté par ce `type` : **c'est le gabarit
  réutilisable** qui permettra à l'association d'ajouter « sociabilisation », « accueil d'un
  lapin », etc. sans développeur.
- Pages `/conseils` (cartes par thème, vue `conseils.ejs`) et `/conseils/:slug`
  (vue `conseil.ejs`), fil d'Ariane via la variable `fil` déjà gérée par `partials/debut.ejs`,
  JSON-LD `Article` par fiche, et les fiches ajoutées au `sitemap.xml`
  (`routes/public.js` lignes 207-219).
- **Première fiche, l'alimentation du chat**, avec ses quatre problèmes et le conseil
  correspondant : manque de protéines animales (viser au moins 30 %) ; trop de glucides
  (viser moins de 25 %, sans céréales) ; hydratation insuffisante (alimentation mixte, environ
  un tiers de pâtée) ; surdosage.
- **Calculateur du taux de glucides** : `public/js/conseils.js`, fichier externe (la CSP
  interdit l'inline), chargé seulement quand la fiche déclare `outil: "glucides"`. Cinq champs
  (protéines, matières grasses, cendres, fibres, humidité) et le calcul
  `100 − protéines − MG − cendres − fibres − humidité`. Résultat annoncé dans une zone
  `aria-live="polite"`. Sans JavaScript, la formule reste affichée en clair et les champs sont
  masqués — l'amélioration progressive est la règle du dépôt.
- Édition depuis `/interne/conseils` (liste, création, modification), même moule que
  `interne-animaux.js` : CSRF, écriture atomique, `_version`, validation en liste blanche
  (`src/server/conseils-validation.js`). Aucun HTML libre accepté dans les champs : le texte
  est échappé à l'affichage, comme partout ailleurs.

### Lot 7 — RGPD et pages légales

- Champ `rgpd` ajouté à chaque entrée de `content/formulaires.json` et rendu par
  `src/views/public/partials/formulaire.ejs`, juste avant le bouton d'envoi : finalité, base
  légale (consentement), destinataire (l'association seule), durée de conservation
  (12 mois, ce que fait déjà `src/security/purge.js`), droits d'accès, de rectification et
  d'effacement, adresse de contact.
- Le **consentement photo** est une case distincte du consentement de recontact : deux
  finalités, deux cases, jamais pré-cochées.
- `content/pages.json` → `confidentialite` : document réel décrivant les données réellement
  collectées par chaque formulaire, l'absence de cookie sur les pages publiques (déjà
  vérifiée par `tests/e2e/public.spec.js`), l'absence d'IP sur disque, le cookie `sid` limité
  à `/interne`, et la durée de 12 mois.
- Mineurs : la mention d'accord du représentant légal figure à la fois dans le formulaire
  d'adhésion et dans la politique de confidentialité.

### Lot 8 — Tests, accessibilité et documentation

- `tests/server/routes.test.js` : les nouvelles routes, la redirection `/refuge`, le refus
  d'une adhésion jeune sans représentant légal, l'ouverture du projet d'adoption à un animal
  `en_soins`.
- Nouveaux tests d'intégration : `tests/server/conseils-interne.test.js`,
  `tests/server/soutien-interne.test.js` (CSRF, `_version`, 409, validation).
- `tests/e2e/public.spec.js` : les sept pages (statut, titre, description, canonique,
  JSON-LD), navigation complète et sans défilement horizontal à 320, 768, 1024 et 1600 px avec
  le nouveau menu, `sitemap.xml` incluant les fiches conseils.
- `tests/e2e/accessibilite.spec.js` : les quatre nouvelles pages publiques et les deux
  nouveaux écrans internes ajoutés aux listes axe-core.
- Nouveau `tests/e2e/conseils.spec.js` : navigation index → fiche, et calculateur de glucides
  (saisie, résultat, annonce `aria-live`).
- Nouveau `tests/e2e/soutien.spec.js` : adhésion envoyée → visible dans
  `/interne/soumissions` → export CSV avec les nouvelles colonnes.
- `README.md` : réécrit (ce n'est plus une démonstration), tableau des routes à jour, nouveaux
  fichiers de `content/`, nouveaux écrans internes, et un **mode d'emploi pour les bénévoles**
  — comment ajouter une fiche conseil, une collecte, un animal.

---

## Fichiers principaux touchés

| Fichier | Nature du changement |
|---|---|
| `content/pages.json`, `content/formulaires.json` | réécriture complète du texte, nouvelles pages et formulaires |
| `content/conseils.json`, `content/soutien.json` | **nouveaux** contenus éditables |
| `content/animaux.json` | fiches réelles, statut `en_soins`, nouvelles espèces |
| `src/server/content.js` | index `visibles`, espèces, vérification des nouveaux contenus |
| `src/server/routes/public.js` | 5 nouvelles routes + redirections, réutilisation de `traiter()` |
| `src/server/routes/interne-conseils.js`, `interne-soutien.js` | **nouveaux**, calqués sur `interne-animaux.js` |
| `src/server/animaux-validation.js` | 3 statuts |
| `src/server/conseils-validation.js`, `soutien-validation.js` | **nouveaux** |
| `src/security/validation.js` | schémas `famille_accueil` et `adhesion` |
| `src/views/public/*.ejs`, `partials/debut.ejs`, `partials/formulaire.ejs` | 4 vues nouvelles, marque, menu, mention RGPD |
| `src/views/interne/partials/debut.ejs` | 2 entrées de menu |
| `public/css/main.css`, `interne.css`, `js/main.js`, `js/conseils.js` | palette, motif, menu mobile, calculateur |
| `tests/server/*`, `tests/e2e/*` | mises à jour et 4 nouveaux fichiers |
| `README.md` | réécriture |

Rien à ajouter côté dépendances : `express`, `ejs`, `@playwright/test` et `axe-core` suffisent.

---

## Vérification

Depuis `/Users/vincentchaye/Documents/etudes/Annee1/Semestre1/RSE_project/site_adoption` :

```sh
npm test                 # tests unitaires et d'intégration (node:test)
npm run test:e2e         # Playwright + axe-core, serveur isolé dans .tmp-e2e/
npm start                # http://localhost:3000
```

Parcours manuel à rejouer avant de considérer le lot terminé :

1. **Mobile d'abord** : afficher le site à 320 px de large, dérouler le menu, parcourir les
   sept pages — aucun défilement horizontal, aucune cible de clic sous 44 px.
2. **Adopter** : un animal `en_soins` apparaît dans le catalogue avec son badge, et son
   formulaire « projet d'adoption » s'ouvre et s'envoie.
3. **Famille d'accueil** : envoyer une candidature, la retrouver dans
   `/interne/soumissions?type=famille_accueil`, la passer en « Traitée » avec une note,
   l'exporter en CSV.
4. **Nous soutenir** : envoyer une adhésion jeune **sans** représentant légal → refus en
   français ; avec représentant légal → acceptée ; vérifier les cases reçu fiscal et photos
   dans l'export CSV ; vérifier que l'IBAN et le lien HelloAsso affichent bien un marqueur
   « à compléter ».
5. **Conseils** : créer une seconde fiche depuis `/interne/conseils` et la voir apparaître sur
   `/conseils` sans redémarrage ; sur la fiche alimentation, saisir 32 / 12 / 7 / 3 / 10 dans
   le calculateur → 36 % de glucides annoncés ; désactiver JavaScript → la formule reste lisible.
6. **Sécurité et vie privée** : aucun cookie sur les pages publiques, aucun script ni style en
   ligne, jeton CSRF exigé sur les écritures internes, mention RGPD présente sous chaque
   formulaire.

À l'approbation de ce plan, je le recopie dans
`…/RSE_project/site_adoption/PLAN-petits-oublies.md`, pour que vous puissiez ouvrir une session
Claude dans ce dossier et l'exécuter.

---

## Hors périmètre

- Paiement en ligne traité par le site : il reste chez HelloAsso.
- Publication réelle sur Facebook ou Instagram : l'atelier reste en simulation, le mode réel
  demanderait des comptes développeur et des clés d'API.
- Déploiement et nom de domaine : l'application tourne en local et reste prête à déployer.
  À préparer séparément (l'hébergement gratuit met le serveur en veille et efface les fichiers
  de `data/` à chaque redéploiement s'il n'y a pas de disque persistant — c'est le point à
  arbitrer avant mise en service).
- Migration vers un site statique avec CMS Git : écartée, elle ferait perdre l'espace interne,
  le suivi des demandes et l'export CSV.
