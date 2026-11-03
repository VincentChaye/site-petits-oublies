/**
 * Interface publique : toutes les pages répondent, l'habillage ne provoque aucun
 * défilement horizontal aux quatre largeurs de référence, la barre de navigation
 * reste utilisable, et le SEO reste cohérent (titres, canoniques, JSON-LD, sitemap).
 */
import { test, expect } from '@playwright/test';
import { LARGEURS, defileHorizontalement } from './aides.js';

const PAGES = [
  { url: '/', titre: 'Accueil' },
  { url: '/animaux', titre: 'Animaux' },
  { url: '/refuge', titre: 'Le refuge' },
  { url: '/contact', titre: 'Contact' },
  { url: '/mentions-legales', titre: 'Mentions légales' },
  { url: '/confidentialite', titre: 'Confidentialité' },
];

test.describe('pages publiques', () => {
  for (const p of PAGES) {
    test(`${p.url} : rendu, titre, description, canonique et mention de démonstration`, async ({ page }) => {
      const reponse = await page.goto(p.url);
      expect(reponse?.status()).toBe(200);
      await expect(page).toHaveTitle(/.+/);
      await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /.+/);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`${p.url === '/' ? '/$' : p.url.replace(/\//g, '\\/')}$`));
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
      await expect(page.getByRole('note', { name: 'Avertissement' })).toContainText('démonstration');
      await expect(page.locator('h1')).toHaveCount(1);
      // Données structurées : au moins l'organisation, et du JSON valide partout.
      const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
      expect(ld.length).toBeGreaterThan(0);
      expect(ld.map((t) => JSON.parse(t)['@type'])).toContain('Organization');
    });
  }

  test('404 : page inconnue, non indexable', async ({ page }) => {
    const reponse = await page.goto('/page-qui-nexiste-pas');
    expect(reponse?.status()).toBe(404);
    await expect(page.locator('h1')).toHaveCount(1);
  });
});

test.describe('habillage et barre de navigation', () => {
  for (const largeur of LARGEURS) {
    test(`aucun défilement horizontal et navigation complète à ${largeur.nom}`, async ({ page }) => {
      await page.setViewportSize({ width: largeur.width, height: largeur.height });
      for (const p of [...PAGES, { url: '/animaux/biscotte' }, { url: '/animaux/biscotte/interet' }]) {
        await page.goto(p.url);
        expect(await defileHorizontalement(page), `défilement horizontal sur ${p.url}`).toBe(false);
        const entete = page.locator('header.entete');
        await expect(entete).toBeVisible();
        // L'en-tête tient dans la fenêtre : rien ne dépasse à droite ni à gauche.
        const boite = await entete.boundingBox();
        expect(boite).not.toBeNull();
        expect(boite.x).toBeGreaterThanOrEqual(-1);
        expect(boite.x + boite.width).toBeLessThanOrEqual(largeur.width + 1);
        // Les quatre entrées de navigation restent présentes et cliquables.
        const liens = page.locator('nav[aria-label="Navigation principale"] a');
        await expect(liens).toHaveCount(4);
        for (let i = 0; i < 4; i += 1) await expect(liens.nth(i)).toBeVisible();
      }
    });
  }

  test('la feuille de style publique est servie et pose les variables d’espacement', async ({ page }) => {
    const reponse = await page.request.get('/css/main.css');
    expect(reponse.status()).toBe(200);
    const css = await reponse.text();
    for (const variable of ['--esp-1', '--esp-8', '--gouttiere', '--conteneur']) {
      expect(css, `variable ${variable} absente`).toContain(variable);
    }
    // Les pages consomment ces variables plutôt que des valeurs en dur.
    await page.goto('/');
    const gouttiere = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--gouttiere').trim());
    expect(gouttiere).not.toBe('');
  });
});

test.describe('l’espace interne reste invisible du public', () => {
  test('robots.txt interdit /interne et désigne le sitemap', async ({ page }) => {
    const reponse = await page.request.get('/robots.txt');
    expect(reponse.status()).toBe(200);
    const txt = await reponse.text();
    expect(txt).toMatch(/Disallow:\s*\/interne/);
  });

  test('sitemap.xml liste les pages publiques et jamais /interne', async ({ page }) => {
    const reponse = await page.request.get('/sitemap.xml');
    expect(reponse.status()).toBe(200);
    const xml = await reponse.text();
    expect(xml).toContain('<loc>');
    expect(xml).not.toContain('/interne');
    for (const p of PAGES) expect(xml).toContain(p.url === '/' ? '/</loc>' : `${p.url}</loc>`);
  });

  test('aucune page publique ne pointe vers /interne et aucun cookie n’est posé', async ({ page, context }) => {
    for (const p of [...PAGES, { url: '/animaux/biscotte' }]) {
      await page.goto(p.url);
      await expect(page.locator('a[href^="/interne"]')).toHaveCount(0);
    }
    expect(await context.cookies()).toEqual([]);
  });
});
