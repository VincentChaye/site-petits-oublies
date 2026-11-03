/**
 * Tests d'intégration des routes : parcours public (pages, filtres, fiches,
 * formulaires) et espace interne (connexion, CSRF, file, export CSV).
 * Le serveur est monté sur un port éphémère, les données dans un dossier temporaire.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../../src/server/app.js';
import { chargerContenu } from '../../src/server/content.js';
import { createStore } from '../../src/server/store.js';
import { createSoumissions } from '../../src/server/soumissions.js';
import { createCompteurVues } from '../../src/server/vues.js';
import { createSocialRuntime } from '../../src/server/social.js';
import { createPublicRouter } from '../../src/server/routes/public.js';
import { createInterneRouter } from '../../src/server/routes/interne.js';
import { issueFormToken } from '../../src/security/antispam.js';

const SECRET = 'secret-de-test-0123456789abcdef-0123456789abcdef';
const ENV = {
  SOCIAL_MODE: 'simulation',
  SOCIAL_FACEBOOK_ENABLED: 'true',
  SOCIAL_FACEBOOK_API_KEY: 'cle-de-test',
  SOCIAL_SITE_URL: 'http://127.0.0.1',
};

let dossier;
let serveur;
let origine;
let contexte;

/** Jeton de formulaire déjà « assez vieux » pour passer le délai minimal anti-robot. */
const jetonPret = () => issueFormToken(SECRET, Date.now() - 10_000);

function corps(champs) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(champs)) p.set(k, v);
  return p;
}

/** POST formulaire, sans suivre les redirections. */
function poster(chemin, champs, { origin = origine, cookie } = {}) {
  const entetes = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (origin) entetes.Origin = origin;
  if (cookie) entetes.Cookie = cookie;
  return fetch(`${origine}${chemin}`, { method: 'POST', headers: entetes, body: corps(champs), redirect: 'manual' });
}

const obtenir = (chemin, cookie) => fetch(`${origine}${chemin}`, {
  headers: cookie ? { Cookie: cookie } : {},
  redirect: 'manual',
});

before(async () => {
  dossier = mkdtempSync(join(tmpdir(), 'routes-'));
  const contenu = chargerContenu();
  const store = createStore({ dir: dossier });
  const soumissions = createSoumissions({ store });
  const vues = createCompteurVues({ store, flushMs: 5 });
  await vues.charger();
  const social = createSocialRuntime({ env: ENV, dataDir: dossier, logger: { info() {}, warn() {}, error() {} }, getAnimaux: () => contenu.animaux, getVues: () => vues.tous(), getSeuil: () => 5 });
  contexte = { contenu, store, soumissions, vues, social };

  const app = createApp({
    logger: { error() {} },
    mount(a) {
      a.use('/interne', createInterneRouter({ contenu, soumissions, vues, social, secret: SECRET, seuil: 5 }));
      // Limite de débit relevée : la suite envoie bien plus de 10 formulaires.
      a.use(createPublicRouter({ contenu, soumissions, vues, baseUrl: 'http://127.0.0.1', secret: SECRET, maxEnvois: 500, logger: { error() {}, warn() {} } }));
    },
  });
  serveur = app.listen(0, '127.0.0.1');
  await new Promise((ok) => serveur.once('listening', ok));
  origine = `http://127.0.0.1:${serveur.address().port}`;
});

after(async () => {
  contexte?.social?.stop();
  await contexte?.vues?.stop();
  await new Promise((ok) => serveur.close(ok));
  rmSync(dossier, { recursive: true, force: true });
});

test('pages publiques : les sept pages répondent 200, sans cookie', async () => {
  for (const [chemin, attendu] of [
    ['/', 'Les Petits Oubliés'],
    ['/nos-missions', 'prolifération féline'],
    ['/adopter', 'Adopter un animal'],
    ['/famille-accueil', 'Devenir famille d’accueil'],
    ['/nous-soutenir', 'Nous soutenir'],
    ['/conseils', 'Fiches conseils'],
    ['/conseils/alimentation-du-chat', 'Bien nourrir son chat'],
    ['/contact', 'Contact'],
    ['/mentions-legales', 'Mentions légales'],
    ['/confidentialite', 'confidentialité'],
  ]) {
    const r = await obtenir(chemin);
    assert.equal(r.status, 200, `${chemin} devrait répondre 200`);
    const html = await r.text();
    assert.ok(html.includes(attendu), `${chemin} devrait contenir « ${attendu} »`);
    assert.equal(r.headers.get('set-cookie'), null, `${chemin} ne doit émettre aucun cookie`);
    assert.match(r.headers.get('content-security-policy') ?? '', /default-src 'self'/);
  }
});

test('redirections 301 : les anciennes adresses restent suivies', async () => {
  for (const [ancienne, nouvelle] of [
    ['/refuge', '/nos-missions'],
    ['/animaux', '/adopter'],
    ['/animaux?espece=chat', '/adopter?espece=chat'],
    ['/refuge/benevolat', '/nous-soutenir#formulaire-benevolat'],
    ['/refuge/don', '/nous-soutenir#formulaire-adhesion'],
  ]) {
    const r = await obtenir(ancienne);
    assert.equal(r.status, 301, `${ancienne} devrait répondre 301`);
    assert.equal(r.headers.get('location'), nouvelle);
  }
});

test('mention RGPD présente sous chaque formulaire public', async () => {
  for (const chemin of ['/contact', '/famille-accueil', '/nous-soutenir', '/animaux/biscotte/interet']) {
    const html = await (await obtenir(chemin)).text();
    assert.match(html, /Vos données/, `${chemin} : mention RGPD absente`);
    assert.match(html, /Conservation : 12 mois/, `${chemin} : durée de conservation absente`);
    assert.match(html, /href="\/confidentialite"/, `${chemin} : lien vers la politique absent`);
  }
});

test('catalogue : « en soins » visible, « adopté » masqué, filtres appliqués', async () => {
  const tous = await (await obtenir('/adopter')).text();
  const adopte = contexte.contenu.animaux.find((a) => a.statut === 'adopte');
  const enSoins = contexte.contenu.animaux.find((a) => a.statut === 'en_soins');
  assert.ok(adopte, 'le jeu de données doit contenir un animal adopté');
  assert.ok(enSoins, 'le jeu de données doit contenir un animal en soins');
  assert.ok(!tous.includes(`/animaux/${adopte.slug}"`), 'un animal adopté ne doit pas figurer au catalogue');
  assert.ok(tous.includes(`/animaux/${enSoins.slug}"`), 'un animal en soins doit figurer au catalogue');
  assert.match(tous, /En soins/, 'le statut est écrit en toutes lettres, pas seulement en couleur');

  const chats = await (await obtenir('/adopter?espece=chat')).text();
  for (const a of contexte.contenu.visibles) {
    const present = chats.includes(`/animaux/${a.slug}"`);
    assert.equal(present, a.espece === 'chat', `${a.slug} (${a.espece}) mal filtré`);
  }

  const bidon = await obtenir('/adopter?espece=dragon');
  assert.equal(bidon.status, 200, 'un filtre inconnu est ignoré, pas une erreur');

  // Les nouvelles espèces sont proposées au filtre dès qu'une fiche les utilise.
  const especes = contexte.contenu.options.especes.map((o) => o.valeur);
  for (const e of ['rongeur', 'oiseau']) assert.ok(especes.includes(e), `espèce « ${e} » absente des filtres`);
});

test('fiche animal : rendu, compteur de consultations, 404', async () => {
  const a = contexte.contenu.disponibles[0];
  const avant = contexte.vues.tous()[a.slug] ?? 0;
  const r = await obtenir(`/animaux/${a.slug}`);
  assert.equal(r.status, 200);
  assert.ok((await r.text()).includes(a.nom));
  assert.equal(contexte.vues.tous()[a.slug], avant + 1);

  assert.equal((await obtenir('/animaux/inconnu-xyz')).status, 404);
  assert.equal((await obtenir('/page-absente')).status, 404);
});

test('sitemap : sept pages, fiches conseils et animaux visibles', async () => {
  const xml = await (await obtenir('/sitemap.xml')).text();
  assert.match(xml, /<urlset/);
  for (const u of ['/', '/adopter', '/nos-missions', '/famille-accueil', '/nous-soutenir', '/conseils', '/contact']) {
    assert.ok(xml.includes(`${u}</loc>`), `${u} absent du sitemap`);
  }
  for (const c of contexte.contenu.conseils) assert.ok(xml.includes(`/conseils/${c.slug}<`), `fiche conseil ${c.slug} absente`);
  assert.ok(xml.includes(`/animaux/${contexte.contenu.visibles[0].slug}<`));
  const adopte = contexte.contenu.animaux.find((a) => a.statut === 'adopte');
  assert.ok(!xml.includes(`/animaux/${adopte.slug}<`), 'un animal adopté ne doit pas être dans le sitemap');
  assert.ok(!xml.includes('/animaux</loc>'), 'l’ancienne adresse du catalogue ne doit plus être annoncée');
});

test('formulaire de contact : refus anti-spam', async () => {
  const valide = {
    _form_token: jetonPret(), nom: 'Léa Martin', email: 'lea@example.org',
    sujet: 'Visite', message: 'Bonjour, je souhaite visiter le refuge.', consentement: 'oui',
  };
  assert.equal((await poster('/contact', { ...valide, _form_token: '' })).status, 400, 'jeton absent');
  assert.equal((await poster('/contact', { ...valide, _form_token: issueFormToken(SECRET) })).status, 400, 'jeton trop récent');
  assert.equal((await poster('/contact', valide, { origin: 'http://attaquant.invalid' })).status, 403, 'origine étrangère');
  assert.equal((await poster('/contact', { ...valide, site_web: 'robot' })).status, 400, 'honeypot rempli');
  assert.equal((await contexte.soumissions.compter()).contact, 0, 'aucune soumission ne doit avoir été enregistrée');
});

test('formulaire de contact : erreurs de validation en français, puis succès', async () => {
  const r = await poster('/contact', { _form_token: jetonPret(), nom: 'L', email: 'pas-un-mail', message: 'court' });
  assert.equal(r.status, 400);
  const html = await r.text();
  assert.match(html, /Indiquez une adresse e-mail valide/);
  assert.match(html, /Cochez la case/);

  const ok = await poster('/contact', {
    _form_token: jetonPret(), nom: 'Léa Martin', email: 'lea@example.org',
    sujet: 'Visite', message: 'Bonjour, je souhaite visiter le refuge.', consentement: 'oui',
  });
  assert.equal(ok.status, 303);
  assert.match(ok.headers.get('location'), /^\/contact\?envoye=1/);
  const liste = await contexte.soumissions.lister('contact');
  assert.equal(liste.length, 1);
  assert.equal(liste[0].valeurs.email, 'lea@example.org');
  assert.ok(!('ip' in liste[0]) && !JSON.stringify(liste[0]).includes('127.0.0.1'), 'aucune IP ne doit être enregistrée');

  assert.match(await (await obtenir('/contact?envoye=1')).text(), /votre message a bien été enregistré/);
});

test("projet d'adoption : lié à l'animal, ouvert aux animaux en soins, refusé si adopté", async () => {
  const a = contexte.contenu.disponibles[0];
  const ok = await poster(`/animaux/${a.slug}/interet`, {
    _form_token: jetonPret(), prenom: 'Jules', email: 'jules@example.org',
    logement: 'Maison avec jardin clos', message: 'Cet animal me plaît beaucoup, je suis disponible.',
    consentement: 'oui',
  });
  assert.equal(ok.status, 303);
  const liste = await contexte.soumissions.lister('interet');
  assert.equal(liste.length, 1);
  assert.equal(liste[0].valeurs.animal, a.nom);

  // Un animal en soins accepte un projet d'adoption : c'est le sens du statut.
  const soins = contexte.contenu.animaux.find((x) => x.statut === 'en_soins');
  assert.equal((await obtenir(`/animaux/${soins.slug}/interet`)).status, 200);
  const envoi = await poster(`/animaux/${soins.slug}/interet`, {
    _form_token: jetonPret(), prenom: 'Alix', email: 'alix@example.org',
    logement: 'Appartement avec balcon', message: 'Je suis prêt(e) à attendre la fin de ses soins.',
    consentement: 'oui',
  });
  assert.equal(envoi.status, 303, 'un animal en soins doit accepter un projet d’adoption');

  const adopte = contexte.contenu.animaux.find((x) => x.statut === 'adopte');
  const r = await obtenir(`/animaux/${adopte.slug}/interet`);
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), `/animaux/${adopte.slug}`);
});

test('bénévolat : succès depuis « Nous soutenir »', async () => {
  const ben = await poster('/nous-soutenir/benevolat', {
    _form_token: jetonPret(), nom: 'Sam Durand', email: 'sam@example.org',
    disponibilites: 'Samedi matin', envies: 'Tenir un stand de collecte', consentement: 'oui',
  });
  assert.equal(ben.status, 303);
  assert.match(ben.headers.get('location'), /envoye=benevolat/);
  assert.equal((await contexte.soumissions.compter()).benevolat, 1);
});

/** Candidature complète de famille d'accueil. */
const candidature = (extra = {}) => ({
  _form_token: jetonPret(), nom: 'Durand', prenom: 'Camille', email: 'camille@example.org',
  telephone: '06 20 79 27 08', adresse: '91390 Morsang-sur-Orge', logement: 'maison_jardin',
  autres_animaux: 'aucun', disponibilite: 'Dès maintenant, présence en journée',
  especes: 'chats et lapins', engagements: 'oui', consentement: 'oui', ...extra,
});

test('famille d’accueil : les cinq engagements sont obligatoires, puis succès', async () => {
  const sansEngagements = await poster('/famille-accueil', (() => {
    const c = candidature();
    delete c.engagements;
    return c;
  })());
  assert.equal(sansEngagements.status, 400);
  assert.match(await sansEngagements.text(), /accepter les cinq engagements/);
  assert.equal((await contexte.soumissions.compter()).famille_accueil, 0);

  const ok = await poster('/famille-accueil', candidature());
  assert.equal(ok.status, 303);
  assert.match(ok.headers.get('location'), /^\/famille-accueil\?envoye=1/);
  const liste = await contexte.soumissions.lister('famille_accueil');
  assert.equal(liste.length, 1);
  assert.equal(liste[0].valeurs.logement, 'maison_jardin');
  assert.ok(!JSON.stringify(liste[0]).includes('127.0.0.1'), 'aucune IP ne doit être enregistrée');
});

/** Demande d'adhésion complète. */
const adhesion = (extra = {}) => ({
  _form_token: jetonPret(), nom: 'Petit', prenom: 'Zoé', adresse: '1 rue des Lilas, 91390 Morsang-sur-Orge',
  telephone: '06 20 79 27 08', email: 'zoe@example.org', formule: 'adhesion', consentement: 'oui', ...extra,
});

test('adhésion jeune : refusée sans représentant légal, acceptée avec', async () => {
  const sans = await poster('/nous-soutenir/adhesion', adhesion({ formule: 'adhesion_jeune' }));
  assert.equal(sans.status, 400);
  const html = await sans.text();
  assert.match(html, /représentant légal/);
  assert.equal((await contexte.soumissions.compter()).adhesion, 0, 'rien ne doit être enregistré');

  const avec = await poster('/nous-soutenir/adhesion', adhesion({
    formule: 'adhesion_jeune', representant_nom: 'Petit', representant_prenom: 'Marie',
    representant_accord: 'oui', recu_fiscal: 'oui', photos: 'oui',
  }));
  assert.equal(avec.status, 303);
  assert.match(avec.headers.get('location'), /envoye=adhesion/);
  const [enregistree] = await contexte.soumissions.lister('adhesion');
  assert.equal(enregistree.valeurs.representant_accord, 'oui');
  assert.equal(enregistree.valeurs.recu_fiscal, 'oui');
  assert.equal(enregistree.valeurs.photos, 'oui');
});

test('don libre : montant obligatoire et numérique', async () => {
  const sansMontant = await poster('/nous-soutenir/adhesion', adhesion({ formule: 'don_libre' }));
  assert.equal(sansMontant.status, 400);
  assert.match(await sansMontant.text(), /montant/i);

  const texte = await poster('/nous-soutenir/adhesion', adhesion({ formule: 'don_libre', montant: 'beaucoup' }));
  assert.equal(texte.status, 400);

  const ok = await poster('/nous-soutenir/adhesion', adhesion({ formule: 'don_libre', montant: '30' }));
  assert.equal(ok.status, 303);
  // `lister` rend la plus récente en premier.
  const [derniere] = await contexte.soumissions.lister('adhesion');
  assert.equal(derniere.valeurs.montant, '30');
  // Les consentements non cochés restent vides : jamais pré-cochés, jamais déduits.
  assert.equal(derniere.valeurs.photos, '');
});

test('IBAN et HelloAsso absents : le site affiche un marqueur, n’invente rien', async () => {
  const html = await (await obtenir('/nous-soutenir')).text();
  const p = contexte.contenu.soutien.paiement;
  if (!p.iban || !p.helloasso_url) {
    assert.match(html, /À compléter/, 'le marqueur « à compléter » doit être affiché');
    if (!p.iban) assert.ok(!html.includes('IBAN FR'), 'aucun IBAN ne doit être inventé');
  }
});

test('fiches conseils : liste, fiche, calculateur et 404', async () => {
  const index = await (await obtenir('/conseils')).text();
  assert.match(index, /alimentation-du-chat/);

  const fiche = await (await obtenir('/conseils/alimentation-du-chat')).text();
  assert.match(fiche, /Problème 1/);
  assert.match(fiche, /Conseil de nombreux experts/);
  // Amélioration progressive : la formule reste lisible, le script est chargé à part.
  assert.match(fiche, /100 − protéines − matières grasses/);
  assert.match(fiche, /src="\/js\/conseils\.js"/);
  assert.match(fiche, /aria-live="polite"/);
  assert.ok(!/<script(?![^>]*(?:src=|type="application\/ld\+json"))/.test(fiche), 'aucun script en ligne');

  assert.equal((await obtenir('/conseils/fiche-inconnue')).status, 404);
});

test('espace interne : accès refusé sans session, secret erroné refusé', async () => {
  const r = await obtenir('/interne');
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/interne/connexion');
  assert.equal(r.headers.get('set-cookie'), null);

  const page = await obtenir('/interne/connexion');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /noindex/);

  const faux = await poster('/interne/connexion', { secret: 'mauvais-secret' });
  assert.equal(faux.status, 401);
  assert.equal(faux.headers.get('set-cookie'), null);
  assert.match(await faux.text(), /Connexion impossible : secret invalide\./);

  const horsOrigine = await poster('/interne/connexion', { secret: SECRET }, { origin: 'http://attaquant.invalid' });
  assert.equal(horsOrigine.status, 403);
});

/** Ouvre une session interne et renvoie `{cookie, csrf}`. */
async function connexion() {
  const r = await poster('/interne/connexion', { secret: SECRET });
  assert.equal(r.status, 303);
  const brut = r.headers.get('set-cookie');
  assert.match(brut, /^sid=/);
  assert.match(brut, /HttpOnly/);
  assert.match(brut, /SameSite=Strict/);
  assert.match(brut, /Path=\/interne/);
  const cookie = brut.split(';')[0];
  const html = await (await obtenir('/interne', cookie)).text();
  const csrf = /name="_csrf" value="([^"]+)"/.exec(html)?.[1];
  assert.ok(csrf, 'un jeton CSRF doit être présent dans les pages internes');
  return { cookie, csrf };
}

test('espace interne : tableau de bord, journal, calendrier accessibles', async () => {
  const { cookie } = await connexion();
  for (const [chemin, attendu] of [
    ['/interne', 'Tableau de bord'],
    ['/interne/file', 'File de validation'],
    ['/interne/calendrier', 'Calendrier des envois'],
    ['/interne/journal', 'Journal d’envoi'],
    ['/interne/soumissions', 'Soumissions des formulaires'],
  ]) {
    const r = await obtenir(chemin, cookie);
    assert.equal(r.status, 200, `${chemin} devrait répondre 200`);
    assert.ok((await r.text()).includes(attendu), `${chemin} devrait contenir « ${attendu} »`);
  }
  const tb = await (await obtenir('/interne', cookie)).text();
  assert.ok(tb.includes(contexte.contenu.disponibles[0].nom), 'le classement doit lister les fiches');
});

test('espace interne : CSRF exigé, cycle de validation d’un post simulé', async () => {
  const { cookie, csrf } = await connexion();
  const scan = contexte.social.scan();
  assert.ok(scan.created.length > 0, 'le scan doit proposer au moins un post');
  const id = scan.created[0].id;

  const sansJeton = await poster(`/interne/file/${id}/modifier`, { text: 'Tentative sans jeton.' }, { cookie });
  assert.equal(sansJeton.status, 403, 'une action sans jeton CSRF doit être refusée');

  const modif = await poster(`/interne/file/${id}/modifier`, { _csrf: csrf, text: 'Texte relu par l’équipe.' }, { cookie });
  assert.equal(modif.status, 303);
  assert.equal(contexte.social.service.get(id).text, 'Texte relu par l’équipe.');

  const appro = await poster(`/interne/file/${id}/approuver`, { _csrf: csrf, scheduledAt: '' }, { cookie });
  assert.equal(appro.status, 303);
  assert.equal(contexte.social.service.get(id).status, 'planifie');

  const { processed } = await contexte.social.service.runDue();
  assert.equal(processed.length, 1);
  assert.equal(processed[0].ok, true, 'envoi simulé réussi');
  assert.equal(contexte.social.service.get(id).status, 'envoye');

  const journal = await (await obtenir('/interne/journal', cookie)).text();
  assert.match(journal, /simulation/);
  assert.ok(!journal.includes('cle-de-test'), 'aucune clé d’API ne doit apparaître dans le journal');

  const autre = contexte.social.service.list({ status: 'en_validation' })[0];
  const rejet = await poster(`/interne/file/${autre.id}/rejeter`, { _csrf: csrf, reason: 'Hors sujet' }, { cookie });
  assert.equal(rejet.status, 303);
  assert.equal(contexte.social.service.get(autre.id).status, 'rejete');

  const inconnu = await poster('/interne/file/post-inexistant/rejeter', { _csrf: csrf }, { cookie });
  assert.equal(inconnu.status, 303);
  assert.match(inconnu.headers.get('location'), /ko=echec/);
});

test('espace interne : export CSV protégé contre l’injection de formules', async () => {
  const { cookie } = await connexion();
  await poster('/contact', {
    _form_token: jetonPret(), nom: '=1+1', email: 'piege@example.org',
    sujet: 'Test', message: 'Un message de test suffisamment long.', consentement: 'oui',
  });
  const r = await obtenir('/interne/soumissions/export.csv?type=contact', cookie);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') ?? '', /text\/csv/);
  assert.match(r.headers.get('content-disposition') ?? '', /attachment; filename="soumissions-contact\.csv"/);
  const csv = await r.text();
  assert.ok(csv.includes("'=1+1"), 'une valeur commençant par = doit être préfixée');
  assert.ok(csv.includes('lea@example.org'));
});

test('espace interne : déconnexion et persistance sur disque', async () => {
  const { cookie, csrf } = await connexion();
  const sortie = await poster('/interne/deconnexion', { _csrf: csrf }, { cookie });
  assert.equal(sortie.status, 303);
  assert.match(sortie.headers.get('set-cookie'), /sid=; .*Max-Age=0/);
  assert.equal((await obtenir('/interne', cookie)).headers.get('location'), '/interne/connexion');

  await contexte.vues.flush();
  const fichierVues = join(dossier, 'vues.json');
  assert.ok(existsSync(fichierVues), 'les consultations doivent être persistées');
  assert.ok(Object.values(JSON.parse(readFileSync(fichierVues, 'utf8'))).some((n) => n > 0));
  assert.ok(existsSync(join(dossier, 'soumissions.json')), 'les soumissions doivent être persistées');
});
