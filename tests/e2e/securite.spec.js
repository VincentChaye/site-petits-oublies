/**
 * Socle de sécurité vu du navigateur : accès refusé sans session, en-têtes
 * (CSP sans `unsafe-inline`, `no-store` sur /interne), aucun style ni script en
 * ligne, jeton CSRF exigé sur les écritures, déconnexion effective.
 */
import { test, expect } from '@playwright/test';
import { connexionInterne } from './aides.js';

const INTERNES = ['/interne', '/interne/animaux', '/interne/soumissions', '/interne/atelier', '/interne/file', '/interne/calendrier', '/interne/journal'];

test.describe('accès à l’espace interne', () => {
  test('sans session, toute page interne renvoie vers la connexion', async ({ page }) => {
    for (const url of INTERNES) {
      await page.goto(url);
      expect(new URL(page.url()).pathname, url).toBe('/interne/connexion');
    }
  });

  test('un secret erroné est refusé sans révéler ce qui est faux', async ({ page }) => {
    await page.goto('/interne/connexion');
    await page.getByLabel('Secret').fill('mauvais-secret-de-plus-de-32-caracteres');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByRole('alert')).toContainText('Connexion impossible : secret invalide.');
    expect(await page.context().cookies()).toEqual([]);
  });

  test('déconnexion : le cookie est effacé et l’accès redevient impossible', async ({ page }) => {
    await connexionInterne(page);
    expect((await page.context().cookies()).map((c) => c.name)).toContain('sid');
    await page.getByRole('button', { name: 'Se déconnecter' }).click();
    expect(new URL(page.url()).pathname).toBe('/interne/connexion');
    await page.goto('/interne');
    expect(new URL(page.url()).pathname).toBe('/interne/connexion');
  });
});

test.describe('en-têtes et absence de code en ligne', () => {
  test('CSP sans unsafe-inline et en-têtes de durcissement sur une page publique', async ({ page }) => {
    const reponse = await page.request.get('/');
    const h = reponse.headers();
    expect(h['content-security-policy']).toContain("script-src 'self'");
    expect(h['content-security-policy']).toContain("style-src 'self'");
    expect(h['content-security-policy']).not.toContain('unsafe-inline');
    expect(h['content-security-policy']).not.toContain('unsafe-eval');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['referrer-policy']).toBeTruthy();
    expect(h['x-powered-by']).toBeUndefined();
  });

  test('/interne n’est jamais mis en cache et porte X-Robots-Tag noindex', async ({ page }) => {
    await connexionInterne(page);
    const reponse = await page.request.get('/interne');
    expect(reponse.headers()['cache-control']).toContain('no-store');
    expect(reponse.headers()['x-robots-tag']).toContain('noindex');
  });

  test('aucun attribut style ni script en ligne, publiquement comme en interne', async ({ page }) => {
    const compter = () => page.evaluate(() => ({
      styleAttr: document.querySelectorAll('[style]').length,
      styleBalise: document.querySelectorAll('style').length,
      scriptEnLigne: [...document.querySelectorAll('script')].filter((s) => !s.src && s.type !== 'application/ld+json').length,
      handlers: [...document.querySelectorAll('*')].filter((e) => [...e.attributes].some((a) => a.name.startsWith('on'))).length,
    }));
    for (const url of ['/', '/animaux', '/animaux/biscotte/interet']) {
      await page.goto(url);
      expect(await compter(), url).toEqual({ styleAttr: 0, styleBalise: 0, scriptEnLigne: 0, handlers: 0 });
    }
    await connexionInterne(page);
    for (const url of INTERNES) {
      await page.goto(url);
      expect(await compter(), url).toEqual({ styleAttr: 0, styleBalise: 0, scriptEnLigne: 0, handlers: 0 });
    }
  });

  test('aucune erreur de console sur les pages publiques', async ({ page }) => {
    const erreurs = [];
    page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()); });
    page.on('pageerror', (e) => erreurs.push(String(e)));
    for (const url of ['/', '/animaux', '/animaux/biscotte', '/refuge', '/contact']) await page.goto(url);
    expect(erreurs).toEqual([]);
  });
});

test.describe('écritures internes', () => {
  test('sans jeton CSRF, l’écriture est refusée (403) et rien ne change', async ({ page }) => {
    await connexionInterne(page);
    const avant = await (await page.request.get('/interne/animaux')).text();
    const reponse = await page.request.post('/interne/soumissions/inexistant', { form: { statut: 'traitee' } });
    expect(reponse.status()).toBe(403);
    expect(await reponse.text()).toContain('jeton CSRF');
    expect(await (await page.request.get('/interne/animaux')).text()).toBe(avant);
  });

  test('une écriture annoncée comme venant d’un autre site est refusée (403)', async ({ page }) => {
    await connexionInterne(page);
    const reponse = await page.request.post('/interne/soumissions/inexistant', {
      form: { statut: 'traitee' },
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(reponse.status()).toBe(403);
    expect(await reponse.text()).toContain('origine non autorisée');
  });

  test('un formulaire public envoyé trop vite est refusé (délai anti-robot)', async ({ page }) => {
    await page.goto('/animaux/biscotte/interet');
    await page.locator('#formulaire-interet-prenom').fill('Trop-Vite');
    await page.locator('#formulaire-interet-email').fill('trop.vite@exemple.test');
    await page.locator('#formulaire-interet-logement').fill('Appartement lumineux au deuxième étage.');
    await page.locator('#formulaire-interet-message').fill('Envoi immédiat, sans attendre le délai.');
    await page.locator('#formulaire-interet-consentement').check();
    await page.getByRole('button', { name: 'Envoyer ma demande' }).click(); // sans attendre les 3 s
    await expect(page.getByRole('alert')).toContainText('trop rapidement');
  });
});
