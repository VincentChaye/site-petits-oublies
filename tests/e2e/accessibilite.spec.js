/**
 * Rapport d'accessibilité axe-core : zéro violation d'impact « critical » ou
 * « serious » sur les pages publiques et internes, aux largeurs mobile et bureau.
 * Vérifie aussi la navigation clavier (lien d'évitement, focus visible).
 */
import { test, expect } from '@playwright/test';
import { connexionInterne, injecterAxe, violationsGraves, LARGEURS } from './aides.js';

const PUBLIQUES = ['/', '/animaux', '/animaux/biscotte', '/animaux/biscotte/interet', '/refuge', '/contact', '/mentions-legales', '/confidentialite'];
const INTERNES = ['/interne', '/interne/animaux', '/interne/animaux/nouveau', '/interne/animaux/biscotte/modifier', '/interne/soumissions', '/interne/atelier', '/interne/file', '/interne/calendrier', '/interne/journal'];

/** Message d'échec lisible : une ligne par violation. */
const detailler = (v) => v.map((x) => `${x.impact} · ${x.id} (${x.noeuds} élément(s)) : ${x.aide}`).join('\n');

test.describe('accessibilité des pages publiques', () => {
  test.beforeEach(async ({ page }) => { await injecterAxe(page); });

  for (const url of PUBLIQUES) {
    test(`axe-core sur ${url} : aucune violation critique ni sérieuse`, async ({ page }) => {
      await page.goto(url);
      const v = await violationsGraves(page);
      expect(v, `${url}\n${detailler(v)}`).toEqual([]);
    });
  }

  test('axe-core sur / en 320 px et en 1600 px', async ({ page }) => {
    for (const l of [LARGEURS[0], LARGEURS[3]]) {
      await page.setViewportSize({ width: l.width, height: l.height });
      await page.goto('/animaux');
      const v = await violationsGraves(page);
      expect(v, `${l.nom}\n${detailler(v)}`).toEqual([]);
    }
  });

  test('page de connexion interne : aucune violation critique ni sérieuse', async ({ page }) => {
    await page.goto('/interne/connexion');
    const v = await violationsGraves(page);
    expect(v, detailler(v)).toEqual([]);
  });
});

test.describe('accessibilité de l’espace interne', () => {
  test.beforeEach(async ({ page }) => { await injecterAxe(page); });

  for (const url of INTERNES) {
    test(`axe-core sur ${url} : aucune violation critique ni sérieuse`, async ({ page }) => {
      await connexionInterne(page);
      await page.goto(url);
      const v = await violationsGraves(page);
      expect(v, `${url}\n${detailler(v)}`).toEqual([]);
    });
  }
});

test.describe('navigation clavier', () => {
  test('le lien d’évitement est le premier élément focalisable et mène au contenu', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const premier = page.locator(':focus');
    await expect(premier).toHaveText('Aller au contenu');
    await premier.press('Enter');
    expect(new URL(page.url()).hash).toBe('#contenu');
  });

  test('les liens de navigation ont un focus visible (contour ou fond modifié)', async ({ page }) => {
    await page.goto('/');
    const lien = page.locator('nav[aria-label="Navigation principale"] a').first();
    await lien.focus();
    const style = await lien.evaluate((el) => {
      const s = getComputedStyle(el);
      return { outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth, boxShadow: s.boxShadow };
    });
    const visible = (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || (style.boxShadow !== 'none' && style.boxShadow !== '');
    expect(visible, `focus non visible : ${JSON.stringify(style)}`).toBe(true);
  });

  test('tout le formulaire d’intérêt est atteignable au clavier, sauf le champ piège', async ({ page }) => {
    await page.goto('/animaux/biscotte/interet');
    const piege = page.locator('#formulaire-interet-site_web');
    await expect(piege).toHaveAttribute('tabindex', '-1');
    for (const id of ['prenom', 'email', 'telephone', 'logement', 'message', 'consentement']) {
      const champ = page.locator(`#formulaire-interet-${id}`);
      await champ.focus();
      await expect(champ).toBeFocused();
    }
  });
});
