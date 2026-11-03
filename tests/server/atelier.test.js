/**
 * Atelier de publication : dépôt manuel, aperçu sans écriture, limites par réseau,
 * liste blanche, CSRF, anti-doublon au scan, signalement des fiches adoptées.
 * Données et contenu dans des dossiers temporaires.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync, cpSync, statSync } from 'node:fs';
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
import { TRIGGERS } from '../../src/integrations/index.js';

const SECRET = 'secret-de-test-0123456789abcdef-0123456789abcdef';
const ENV = {
  SOCIAL_MODE: 'simulation', SOCIAL_SITE_URL: 'http://127.0.0.1',
  SOCIAL_FACEBOOK_ENABLED: 'true', SOCIAL_FACEBOOK_API_KEY: 'cle-facebook-test',
  SOCIAL_INSTAGRAM_ENABLED: 'true', SOCIAL_INSTAGRAM_API_KEY: 'cle-instagram-test',
};
const REEL = new URL('../../content/', import.meta.url);
const silence = { info() {}, warn() {}, error() {} };
const JOUR = 86_400_000;
const horloge = { t: Date.parse('2026-07-10T10:00:00Z') };

let dossier; let dossierContenu; let serveur; let origine; let contenu; let social; let vues; let service;

before(async () => {
  dossier = mkdtempSync(join(tmpdir(), 'atelier-donnees-'));
  dossierContenu = mkdtempSync(join(tmpdir(), 'atelier-contenu-'));
  cpSync(new URL('.', REEL), dossierContenu, { recursive: true });
  contenu = chargerContenu({ dir: dossierContenu });
  const store = createStore({ dir: dossier });
  const soumissions = createSoumissions({ store });
  vues = createCompteurVues({ store, flushMs: 60_000, logger: silence });
  await vues.charger();
  social = createSocialRuntime({ env: ENV, dataDir: dossier, logger: silence, now: () => horloge.t, getAnimaux: () => contenu.animaux, getVues: () => vues.tous(), getSeuil: () => 5 });
  service = social.service;
  const app = createApp({
    logger: silence,
    mount(a) {
      a.use('/interne', createInterneRouter({ contenu, soumissions, vues, social, secret: SECRET, seuil: 5, logger: silence }));
      a.use(createPublicRouter({ contenu, soumissions, vues, baseUrl: 'http://127.0.0.1', secret: SECRET, logger: silence }));
    },
  });
  serveur = app.listen(0, '127.0.0.1');
  await new Promise((ok) => serveur.once('listening', ok));
  origine = `http://127.0.0.1:${serveur.address().port}`;
});
after(async () => {
  social?.stop();
  await vues?.stop();
  await new Promise((ok) => serveur.close(ok));
  rmSync(dossier, { recursive: true, force: true });
  rmSync(dossierContenu, { recursive: true, force: true });
});

const brut = (chemin, corps, { cookie } = {}) => fetch(`${origine}${chemin}`, {
  method: 'POST', redirect: 'manual',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origine, ...(cookie ? { Cookie: cookie } : {}) },
  body: corps,
});
const poster = (chemin, champs, opts) => brut(chemin, new URLSearchParams(Object.entries(champs)).toString(), opts);
const obtenir = (chemin, cookie) => fetch(`${origine}${chemin}`, { headers: cookie ? { Cookie: cookie } : {}, redirect: 'manual' });

let session;
async function connexion() {
  if (session) return session;
  const r = await poster('/interne/connexion', { secret: SECRET });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const html = await (await obtenir('/interne', cookie)).text();
  session = { cookie, csrf: /name="_csrf" value="([^"]+)"/.exec(html)[1] };
  return session;
}
async function deposer(champs, chemin = '/interne/atelier/deposer') {
  const s = await connexion();
  return poster(chemin, { _csrf: s.csrf, animal: 'biscotte', reseau: 'facebook', gabarit: '', cadrage: '', texte: 'Bonjour', hashtags: '', alt: '', ...champs }, { cookie: s.cookie });
}
const postsDe = (animal) => service.list().filter((p) => p.animalId === animal && p.trigger === 'manuel');

function instantane(dir) {
  const out = {};
  for (const f of readdirSync(dir, { recursive: true })) {
    const chemin = join(dir, f);
    if (statSync(chemin).isFile()) out[f] = readFileSync(chemin, 'utf8');
  }
  return out;
}

test('TRIGGERS inchangé (ni manuel ni atelier)', () => {
  assert.deepEqual(TRIGGERS, ['arrivee', 'peu_consulte', 'relance_periodique']);
});

test('sans session : redirection ; CSRF absent ou faux : 403, rien déposé', async () => {
  const sans = await poster('/interne/atelier/deposer', { animal: 'biscotte', reseau: 'facebook', texte: 'x' });
  assert.equal(sans.status, 303);
  assert.match(sans.headers.get('location'), /connexion$/);
  assert.equal((await obtenir('/interne/atelier')).status, 303);
  const s = await connexion();
  for (const chemin of ['/interne/atelier/deposer', '/interne/atelier/apercu']) {
    assert.equal((await poster(chemin, { animal: 'biscotte', reseau: 'facebook', texte: 'x' }, { cookie: s.cookie })).status, 403);
    assert.equal((await poster(chemin, { _csrf: 'faux', animal: 'biscotte', reseau: 'facebook', texte: 'x' }, { cookie: s.cookie })).status, 403);
  }
  assert.equal(postsDe('biscotte').length, 0);
});

test('formulaire GET : 200, jeton CSRF, ni style ni script en ligne', async () => {
  const s = await connexion();
  const r = await obtenir('/interne/atelier', s.cookie);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /name="_csrf"/);
  assert.doesNotMatch(html, /\sstyle=|<style|onclick=|<script(?![^>]*\ssrc=)/i);
  assert.ok(!html.includes('value="filou"')); // fiche adoptée absente de la liste
  assert.doesNotMatch(await (await obtenir('/')).text(), /\/interne/);
});

test('préremplissage GET : gabarit rendu, texte et hashtags séparés ; paramètres invalides → 422', async () => {
  const s = await connexion();
  const ok = await obtenir('/interne/atelier?animal=biscotte&reseau=facebook&gabarit=arrivee', s.cookie);
  assert.equal(ok.status, 200);
  const html = await ok.text();
  assert.match(html, /<textarea[^>]*>[^<]*Biscotte, chien/);
  assert.doesNotMatch(html, /\{nom\}|\{url\}/);
  assert.match(html, /value="#adoption #protectionanimale #adoptezpasachetez"/);
  assert.match(html, /http:\/\/127\.0\.0\.1\/animaux\/biscotte/);
  for (const q of ['reseau=x', 'gabarit=manuel', 'animal=filou', 'animal=inconnu', 'animal[]=a', 'cadrage=16:9']) {
    assert.equal((await obtenir(`/interne/atelier?${q}`, s.cookie)).status, 422, q);
  }
});

test('dépôt : liste blanche (__proto__, imageUrl client ignoré), image et alt venant de la fiche', async () => {
  const s = await connexion();
  const r = await brut('/interne/atelier/deposer', new URLSearchParams({
    _csrf: s.csrf, animal: 'moustache', reseau: 'instagram', cadrage: '4:5', texte: 'Coucou', hashtags: '#chat', alt: 'Un chat gris',
    imageUrl: 'https://evil.example/x.png', url: 'https://evil.example', status: 'envoye', trigger: 'arrivee', __proto__: 'x',
  }).toString(), { cookie: s.cookie });
  assert.equal(r.status, 303);
  assert.match(r.headers.get('location'), /\/interne\/file\?ok=depose/);
  const [p] = postsDe('moustache');
  assert.equal(p.status, 'en_validation');
  assert.equal(p.trigger, 'manuel');
  assert.equal(p.imageUrl, contenu.animal('moustache').photos[0].src);
  assert.equal(p.alt, 'Un chat gris');
  assert.equal(p.text, 'Coucou\n\n#chat');
  assert.equal(p.history[0].action, 'cree');
  assert.equal(({}).polluted, undefined);
  assert.ok(!JSON.stringify(p).includes('evil.example'));
  const file = await (await obtenir('/interne/file?ok=depose', s.cookie)).text();
  assert.match(file, /Publication déposée/);
  assert.match(file, /Dépôt manuel \(atelier\)/);
  assert.match(file, /Un chat gris/);
});

test('valeurs non-chaînes, réseau, gabarit, cadrage, fiche inconnue : 422 sans plantage', async () => {
  const s = await connexion();
  const base = `_csrf=${encodeURIComponent(s.csrf)}&animal=noisette&reseau=facebook`;
  // extended:false → seules les clés répétées donnent des tableaux ; `x[]=a` n’est pas une clé de la liste blanche.
  for (const extra of ['&texte=a&texte=b', '&texte=a&alt=b&alt=c', '&texte=a&hashtags=%23a&hashtags=%23b', '&texte=a&gabarit=arrivee&gabarit=arrivee']) {
    const r = await brut('/interne/atelier/deposer', base + extra, { cookie: s.cookie });
    assert.equal(r.status, 422, extra);
    assert.match(await r.text(), /est invalide/);
  }
  for (const extra of ['&texte[]=a', '&texte[a]=1&texte[b]=2']) {
    assert.equal((await brut('/interne/atelier/deposer', base + extra, { cookie: s.cookie })).status, 422, extra);
  }
  for (const champs of [{ reseau: 'x' }, { reseau: 'linkedin' }, { reseau: 'Facebook' }, { gabarit: 'manuel' }, { gabarit: 'atelier' }, { animal: 'fantome' }, { animal: '' }, { texte: '   ' }, { reseau: 'instagram', cadrage: '16:9' }]) {
    const r = await deposer({ animal: 'noisette', ...champs });
    assert.equal(r.status, 422, JSON.stringify(champs));
  }
  assert.equal(postsDe('noisette').length, 0);
});

test('limites Instagram : 2200 points de code (emojis compris), +1 refusé, hashtags comptés', async () => {
  const a = 'sucre';
  assert.equal((await deposer({ animal: a, reseau: 'instagram', texte: 'a'.repeat(2201) })).status, 422);
  // Corps limité à 20 ko : emojis mêlés à des caractères ASCII (1 emoji = 1 point de code).
  assert.equal((await deposer({ animal: a, reseau: 'instagram', texte: `${'😀'.repeat(500)}${'a'.repeat(1701)}` })).status, 422); // 2201
  assert.equal((await deposer({ animal: a, reseau: 'instagram', texte: 'a'.repeat(2194), hashtags: '#abc' })).status, 303); // 2194 + 2 + 4 = 2200 : accepté
  assert.equal((await deposer({ animal: a, reseau: 'instagram', texte: 'a'.repeat(2195), hashtags: '#abc' })).status, 422); // 2201
  assert.equal((await deposer({ animal: a, reseau: 'instagram', texte: `${'😀'.repeat(500)}${'a'.repeat(1700)}` })).status, 303); // 2200
  assert.equal(postsDe(a).length, 2);
});

test('limites Facebook : .length ≤ 5000 (emojis = 2 unités), +1 refusé', async () => {
  const a = 'albertine';
  assert.equal((await deposer({ animal: a, texte: 'a'.repeat(5001) })).status, 422);
  // Corps limité à 20 ko : 500 emojis (= 1000 unités) + ASCII.
  assert.equal((await deposer({ animal: a, texte: `${'😀'.repeat(500)}${'a'.repeat(4001)}` })).status, 422); // 5001
  assert.equal((await deposer({ animal: a, texte: 'a'.repeat(4994), hashtags: '#abc' })).status, 303); // 5000
  assert.equal((await deposer({ animal: a, texte: 'a'.repeat(4995), hashtags: '#abc' })).status, 422); // 5001
  assert.equal((await deposer({ animal: a, texte: `${'😀'.repeat(500)}${'a'.repeat(4000)}` })).status, 303); // 5000
  for (const p of postsDe(a)) assert.ok(p.text.length <= 5000);
});

test('hashtags : 30/31 Instagram, 10/11 Facebook, dédoublonnés, syntaxe contrôlée', async () => {
  const tags = (n) => Array.from({ length: n }, (_, i) => `#t${i}`).join(' ');
  assert.equal((await deposer({ animal: 'roxy', reseau: 'instagram', hashtags: tags(31) })).status, 422);
  assert.equal((await deposer({ animal: 'roxy', reseau: 'instagram', hashtags: tags(30) })).status, 303);
  assert.equal((await deposer({ animal: 'roxy', hashtags: tags(11) })).status, 422);
  assert.equal((await deposer({ animal: 'roxy', hashtags: tags(10).replaceAll(' ', ',') })).status, 303);
  for (const mauvais of ['adoption', '#', '#a-b', '##a', '#a.b']) {
    assert.equal((await deposer({ animal: 'roxy', hashtags: mauvais })).status, 422, mauvais);
  }
  const r = await deposer({ animal: 'caramel', hashtags: '#Chat, #chat  #été #chat' });
  assert.equal(r.status, 303);
  assert.equal(postsDe('caramel')[0].text, 'Bonjour\n\n#Chat #été');
});

test('alt : 300 points de code acceptés, 301 refusés', async () => {
  assert.equal((await deposer({ animal: 'luna', alt: '😀'.repeat(301) })).status, 422);
  assert.equal((await deposer({ animal: 'luna', alt: '😀'.repeat(300) })).status, 303);
  assert.equal(postsDe('luna')[0].alt, '😀'.repeat(300));
});

test('Instagram sans image refusé (fiche sans photo)', async () => {
  await contenu.modifierAnimaux((liste) => liste.map((a) => (a.slug === 'pepito' ? { ...a, photos: [] } : a)));
  const r = await deposer({ animal: 'pepito', reseau: 'instagram' });
  assert.equal(r.status, 422);
  assert.match(await r.text(), /image/);
  assert.equal(postsDe('pepito').length, 0);
  assert.equal((await deposer({ animal: 'pepito', reseau: 'facebook' })).status, 303); // Facebook : image facultative
});

test('animal adopté refusé par la route et par le service', async () => {
  const r = await deposer({ animal: 'filou' });
  assert.equal(r.status, 422);
  assert.match(await r.text(), /adoptée/);
  assert.equal(postsDe('filou').length, 0);
  assert.throws(() => service.deposerManuel({ animal: { id: 'filou', slug: 'filou', nom: 'Filou', statut: 'adopte' }, platform: 'facebook', text: 'x' }),
    (e) => e.name === 'SocialError' && e.code === 'ANIMAL_NON_PUBLIABLE' && /adopté/.test(e.message));
});

test('animal en soins refusé par le service : pas de publication pendant les soins', () => {
  assert.throws(() => service.deposerManuel({ animal: { id: 'praline', slug: 'praline', nom: 'Praline', statut: 'en_soins' }, platform: 'facebook', text: 'x' }),
    (e) => e.name === 'SocialError' && e.code === 'ANIMAL_NON_PUBLIABLE' && /en soins/.test(e.message));
});

test('aperçu : aucune écriture, formats Instagram 1:1 / 4:5 et Facebook, coupe « … plus », lien', async () => {
  const avant = instantane(dossier);
  const avantContenu = instantane(dossierContenu);
  const longTexte = 'mot '.repeat(200);
  const insta = await (await deposer({ animal: 'biscotte', reseau: 'instagram', cadrage: '1:1', texte: longTexte, hashtags: '#a #b' }, '/interne/atelier/apercu')).text();
  assert.match(insta, /apercu-instagram-1-1/);
  assert.match(insta, /Carré 1:1/);
  assert.match(insta, /width="1080" height="1080"/);
  assert.match(insta, /non cliquable/);
  assert.match(insta, /… <span class="etiquette">plus<\/span>/);
  assert.match(insta, /<strong>\d+<\/strong> \/ 2200/);
  assert.doesNotMatch(insta, /<a href="http:\/\/127\.0\.0\.1\/animaux/);
  const portrait = await (await deposer({ animal: 'biscotte', reseau: 'instagram', cadrage: '4:5' }, '/interne/atelier/apercu')).text();
  assert.match(portrait, /apercu-instagram-4-5/);
  assert.match(portrait, /width="1080" height="1350"/);
  const fb = await (await deposer({ animal: 'biscotte', reseau: 'facebook', texte: 'Court', hashtags: '#a' }, '/interne/atelier/apercu')).text();
  assert.match(fb, /apercu-facebook/);
  assert.match(fb, /1,91:1/);
  assert.match(fb, /width="1200" height="628"/);
  assert.match(fb, /<a href="http:\/\/127\.0\.0\.1\/animaux\/biscotte">/);
  assert.doesNotMatch(fb, /plus<\/span>/);
  const invalide = await deposer({ texte: '' }, '/interne/atelier/apercu');
  assert.equal(invalide.status, 422);
  assert.deepEqual(instantane(dossier), avant);
  assert.deepEqual(instantane(dossierContenu), avantContenu);
});

test('échappement : <script> dans le texte, les hashtags et l’alt', async () => {
  const payload = '<script>alert(1)</script>';
  const apercu = await (await deposer({ animal: 'biscotte', texte: payload, alt: payload }, '/interne/atelier/apercu')).text();
  assert.doesNotMatch(apercu, /<script>alert/);
  assert.match(apercu, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  const rejet = await (await deposer({ animal: 'biscotte', texte: 'ok', hashtags: payload })).text();
  assert.doesNotMatch(rejet, /<script>alert/);
  const r = await deposer({ animal: 'biscotte', texte: payload });
  assert.equal(r.status, 303);
  const s = await connexion();
  assert.doesNotMatch(await (await obtenir('/interne/file', s.cookie)).text(), /<script>alert/);
});

test('1500 caractères de 3 octets (« … ») : déposés (pas de 413, corps < 20 ko) puis modifiables par edit()', async () => {
  const texte = '…'.repeat(1500);
  const corps = new URLSearchParams({ _csrf: (await connexion()).csrf, animal: 'roxy', reseau: 'facebook', texte }).toString();
  assert.ok(corps.length > 12 * 1024 && corps.length < 20 * 1024);
  const r = await brut('/interne/atelier/deposer', corps, { cookie: (await connexion()).cookie });
  assert.equal(r.status, 303);
  const p = postsDe('roxy').find((x) => x.text.length === 1500);
  assert.ok(p);
  assert.equal(service.edit(p.id, { text: 'x'.repeat(5000) }).text.length, 5000);
});

test('dépôt visible dans la file, modifiable (alt conservé), approuvable, rejetable ; calendrier et journal propres', async () => {
  const s = await connexion();
  assert.equal((await deposer({ animal: 'luna', reseau: 'instagram', texte: 'Luna cherche sa famille', alt: 'Luna dort' })).status, 303);
  const p = postsDe('luna').find((x) => x.platform === 'instagram');
  const file = await (await obtenir('/interne/file', s.cookie)).text();
  assert.ok(file.includes(`id="post-${p.id}"`));
  const m = service.edit(p.id, { text: 'Nouveau texte' });
  assert.equal(m.text, 'Nouveau texte');
  assert.equal(m.alt, 'Luna dort');
  assert.equal(m.status, 'en_validation');
  assert.equal(service.approve(p.id, { scheduledAt: new Date(horloge.t).toISOString() }).alt, 'Luna dort');
  const res = await service.runDue();
  assert.equal(res.processed.length >= 1, true);
  for (const chemin of ['/interne/calendrier', '/interne/journal', '/interne/file']) {
    const rep = await obtenir(chemin, s.cookie);
    assert.equal(rep.status, 200, chemin);
  }
  assert.match(await (await obtenir('/interne/calendrier', s.cookie)).text(), /Luna/);
  const autre = postsDe('luna').find((x) => x.platform === 'facebook') ?? (await deposer({ animal: 'luna', texte: 'Autre' }), postsDe('luna').find((x) => x.platform === 'facebook' && x.status === 'en_validation'));
  assert.equal(service.reject(autre.id, { reason: 'test' }).status, 'rejete');
});

test('scan : pas de doublon après dépôt manuel ; relance après rejet ; période après envoi', () => {
  const animal = { id: 'caramel', slug: 'caramel', nom: 'Caramel', espece: 'chat', statut: 'disponible', photos: [{ src: '/img/animaux/caramel-1.svg' }] };
  const manuel = postsDe('caramel').find((p) => p.platform === 'facebook' && p.status === 'en_validation');
  assert.ok(manuel);
  const sk = (r, pf) => r.skipped.find((x) => x.platform === pf);
  let r = service.generate('peu_consulte', animal);
  assert.equal(sk(r, 'facebook').reason, 'deja_en_file');
  assert.equal(r.created.filter((c) => c.platform === 'facebook').length, 0);
  r = service.generate('arrivee', animal);
  assert.equal(sk(r, 'facebook').reason, 'deja_en_file');
  service.approve(manuel.id);
  assert.equal(sk(service.generate('peu_consulte', animal), 'facebook').reason, 'deja_en_file'); // planifié
  service.reject(manuel.id, { reason: 'test' });
  r = service.generate('peu_consulte', animal);
  assert.equal(r.created.filter((c) => c.platform === 'facebook').length, 1); // un rejeté ne bloque rien
});

test('scan : un dépôt manuel envoyé bloque pendant relanceDays (depot_manuel_recent), puis libère', async () => {
  const animal = { id: 'roxy', slug: 'roxy', nom: 'Roxy', espece: 'chien', statut: 'disponible', photos: [{ src: '/img/animaux/roxy-1.svg' }] };
  for (const p of postsDe('roxy').filter((x) => x.status === 'en_validation')) service.reject(p.id);
  assert.equal((await deposer({ animal: 'roxy', reseau: 'facebook', texte: 'Roxy' })).status, 303);
  const p = postsDe('roxy').find((x) => x.status === 'en_validation' && x.platform === 'facebook');
  service.approve(p.id, { scheduledAt: new Date(horloge.t).toISOString() });
  await service.runDue();
  assert.equal(service.get(p.id).status, 'envoye');
  let r = service.generate('relance_periodique', animal);
  assert.equal(r.skipped.find((x) => x.platform === 'facebook').reason, 'depot_manuel_recent');
  horloge.t += 31 * JOUR;
  r = service.generate('relance_periodique', animal);
  assert.equal(r.created.filter((c) => c.platform === 'facebook').length, 1);
});

test('file : fiche devenue adoptée signalée (état courant) ; fiche disparue sans échec', async () => {
  const s = await connexion();
  assert.equal((await deposer({ animal: 'moustache', texte: 'Moustache à adopter' })).status, 303);
  const avant = await (await obtenir('/interne/file', s.cookie)).text();
  assert.doesNotMatch(avant, /Moustache est désormais adoptée/);
  await contenu.modifierAnimaux((liste) => liste.map((a) => (a.slug === 'moustache' ? { ...a, statut: 'adopte' } : a)));
  const apres = await (await obtenir('/interne/file', s.cookie)).text();
  assert.match(apres, /la fiche de Moustache est désormais adoptée/);
  service.deposerManuel({ animal: { id: 'fantome', slug: 'fantome', nom: 'Fantôme', statut: 'disponible' }, platform: 'facebook', text: 'Boo' });
  const r = await obtenir('/interne/file', s.cookie);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Fantôme/);
});
