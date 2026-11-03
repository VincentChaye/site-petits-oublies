/**
 * Fiches conseils : navigation de l'index vers une fiche, rendu des types de
 * section, et calculateur du taux de glucides (saisie, résultat, annonce
 * `aria-live`, amélioration progressive sans JavaScript).
 */
import { test, expect } from '@playwright/test';
import { defileHorizontalement, LARGEURS } from './aides.js';

test.describe('navigation des fiches conseils', () => {
  test('index → fiche → retour', async ({ page }) => {
    await page.goto('/conseils');
    await expect(page.getByRole('heading', { level: 1, name: 'Fiches conseils' })).toBeVisible();

    await page.getByRole('link', { name: 'Bien nourrir son chat' }).click();
    expect(new URL(page.url()).pathname).toBe('/conseils/alimentation-du-chat');
    await expect(page.getByRole('heading', { level: 1, name: 'Bien nourrir son chat' })).toBeVisible();

    // Fil d'Ariane complet, dernier élément non cliquable.
    const fil = page.locator('nav[aria-label="Fil d\'Ariane"] li');
    await expect(fil).toHaveCount(3);
    await expect(fil.last().locator('[aria-current="page"]')).toHaveText('Bien nourrir son chat');

    await page.getByRole('link', { name: 'Retour aux fiches conseils' }).click();
    expect(new URL(page.url()).pathname).toBe('/conseils');
  });

  test('les types de section sont rendus distinctement', async ({ page }) => {
    await page.goto('/conseils/alimentation-du-chat');
    // « Le saviez-vous ? » : encadré en aside.
    await expect(page.locator('aside.saviez-vous')).toContainText('10 000 repas');
    // Problème + conseil associé.
    await expect(page.getByRole('heading', { name: /Problème 1/ })).toBeVisible();
    await expect(page.locator('.conseil-bloc').first()).toContainText('30 %');
    // Liste à puces finale.
    await expect(page.getByRole('heading', { name: 'À retenir' })).toBeVisible();
  });

  test('données structurées Article et canonique de la fiche', async ({ page }) => {
    await page.goto('/conseils/alimentation-du-chat');
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(ld.map((t) => JSON.parse(t)['@type'])).toContain('Article');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/conseils\/alimentation-du-chat$/);
  });
});

test.describe('calculateur du taux de glucides', () => {
  test('saisie 32 / 12 / 7 / 3 / 10 → 36 % annoncés dans une zone aria-live', async ({ page }) => {
    await page.goto('/conseils/alimentation-du-chat');

    const resultat = page.locator('#glu-resultat');
    await expect(resultat).toHaveAttribute('aria-live', 'polite');
    await expect(resultat).toContainText('Renseignez les cinq valeurs');

    for (const [id, valeur] of [
      ['glu-proteines', '32'], ['glu-grasses', '12'], ['glu-cendres', '7'],
      ['glu-fibres', '3'], ['glu-humidite', '10'],
    ]) {
      await page.locator(`#${id}`).fill(valeur);
    }
    await expect(resultat).toContainText('36 %');
    // 36 % dépasse le repère de 25 % rappelé par la fiche : l'outil le dit.
    await expect(resultat).toContainText('au-dessus du repère de 25 %');
  });

  test('sous le repère, et total incohérent signalé', async ({ page }) => {
    await page.goto('/conseils/alimentation-du-chat');
    const saisir = async (valeurs) => {
      const ids = ['glu-proteines', 'glu-grasses', 'glu-cendres', 'glu-fibres', 'glu-humidite'];
      for (const [i, v] of valeurs.entries()) await page.locator(`#${ids[i]}`).fill(String(v));
    };
    await saisir([45, 20, 7, 3, 8]); // 17 % : sous le repère
    await expect(page.locator('#glu-resultat')).toContainText('en dessous du repère');

    await saisir([60, 30, 10, 5, 10]); // 115 % : impossible
    await expect(page.locator('#glu-resultat')).toContainText('dépasse 100');
  });

  test('tous les champs sont atteignables au clavier et étiquetés', async ({ page }) => {
    await page.goto('/conseils/alimentation-du-chat');
    for (const nom of [/Protéines/, /Matières grasses/, /Cendres/, /Cellulose/, /Humidité/]) {
      const champ = page.getByLabel(nom);
      await champ.focus();
      await expect(champ).toBeFocused();
    }
  });

  test('sans JavaScript, la formule reste lisible et les champs sont masqués', async ({ browser }) => {
    const contexte = await browser.newContext({ javaScriptEnabled: false });
    const page = await contexte.newPage();
    try {
      await page.goto('/conseils/alimentation-du-chat');
      await expect(page.locator('.calculateur-formule')).toContainText('100 − protéines');
      await expect(page.locator('#glu-proteines')).toBeHidden();
      // Le contenu de la fiche, lui, reste entièrement lisible.
      await expect(page.getByRole('heading', { name: /Problème 4/ })).toBeVisible();
    } finally {
      await contexte.close();
    }
  });

  test('aucun défilement horizontal sur la fiche, aux quatre largeurs', async ({ page }) => {
    for (const l of LARGEURS) {
      await page.setViewportSize({ width: l.width, height: l.height });
      await page.goto('/conseils/alimentation-du-chat');
      expect(await defileHorizontalement(page), l.nom).toBe(false);
    }
  });
});
