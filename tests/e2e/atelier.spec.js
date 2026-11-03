/**
 * Parcours « atelier de publication » : composer un post Instagram puis un post
 * Facebook depuis une fiche, vérifier l'aperçu au format du réseau (cadrage de
 * l'image, longueur, coupe du texte, hashtags, rendu du lien), déposer dans la
 * file de validation et approuver. Les envois restent simulés.
 */
import { test, expect } from '@playwright/test';
import { connexionInterne } from './aides.js';

const FICHE = 'caramel';
/** Texte long : dépasse le seuil de coupe Instagram (125 caractères). */
const TEXTE_LONG = 'Caramel cherche sa famille. Il est doux, patient et adore les longues siestes au soleil ; '
  + 'il s’entend avec les enfants calmes et ne demande qu’un canapé et un peu d’attention chaque jour.';
const TEXTE_COURT = 'Caramel vous attend au refuge : venez le rencontrer un samedi après-midi.';

test.describe.serial('atelier de publication', () => {
  test('Instagram : aperçu carré, texte coupé à 125 caractères, lien non cliquable', async ({ page }) => {
    await connexionInterne(page);
    await page.getByRole('link', { name: 'Atelier réseaux' }).click();
    await expect(page.getByRole('heading', { name: 'Atelier de publication' })).toBeVisible();

    await page.locator('#at-animal').selectOption(FICHE);
    await page.locator('#at-reseau').selectOption('instagram');
    await page.locator('#at-cadrage').selectOption('1:1');
    await page.getByRole('button', { name: 'Préremplir avec le gabarit' }).click();

    await page.locator('#at-texte').fill(TEXTE_LONG);
    await page.locator('#at-hashtags').fill('#adoption #refuge, #chat');
    await page.locator('#at-alt').fill('Photo de Caramel, chat roux allongé sur une couverture');
    await page.getByRole('button', { name: 'Voir l’aperçu' }).click();

    const apercu = page.locator('article.apercu');
    await expect(page.getByRole('heading', { name: /Aperçu Instagram/ })).toBeVisible();
    await expect(apercu).toHaveClass(/apercu-instagram-1-1/);
    // Cadrage carré 1080×1080 annoncé sur l'image.
    const image = apercu.locator('img.apercu-image');
    await expect(image).toHaveAttribute('width', '1080');
    await expect(image).toHaveAttribute('height', '1080');
    await expect(image).toHaveAttribute('alt', /Caramel/);
    // Coupe du texte : « … plus » et explication du seuil.
    await expect(apercu.locator('.texte-post')).toContainText('plus');
    await expect(apercu).toContainText('coupé après 125 caractères');
    // Hashtags comptés, lien de la fiche affiché mais non cliquable sur Instagram.
    await expect(apercu).toContainText('Hashtags (3)');
    await expect(apercu).toContainText('non cliquable');
    await expect(apercu).toContainText(`/animaux/${FICHE}`);
    await expect(apercu.getByRole('link')).toHaveCount(0);
    // L'aperçu n'écrit rien : aucun message de dépôt.
    expect(new URL(page.url()).pathname).toBe('/interne/atelier/apercu');
  });

  test('Instagram : dépôt dans la file de validation puis approbation', async ({ page }) => {
    await connexionInterne(page);
    await page.goto(`/interne/atelier?animal=${FICHE}&reseau=instagram`);
    await page.locator('#at-texte').fill(TEXTE_COURT);
    await page.locator('#at-hashtags').fill('#adoption');
    await page.getByRole('button', { name: 'Déposer dans la file de validation' }).click();

    await expect(page.getByRole('status')).toContainText('Publication déposée');
    expect(new URL(page.url()).pathname).toBe('/interne/file');

    const post = page.locator('article.post', { hasText: TEXTE_COURT });
    await expect(post).toHaveCount(1);
    await expect(post).toContainText('Dépôt manuel (atelier)');
    await post.getByRole('button', { name: 'Approuver' }).click();
    await expect(page.getByRole('status')).toContainText('Post approuvé');
    // Approuvé : le post quitte la file de validation.
    await expect(page.locator('article.post', { hasText: TEXTE_COURT })).toHaveCount(0);
    // Il apparaît au calendrier des envois (simulés).
    await page.goto('/interne/calendrier');
    await expect(page.locator('main')).toContainText('Caramel');
  });

  test('Facebook : aperçu paysage, seuil de coupe plus large, lien cliquable', async ({ page }) => {
    await connexionInterne(page);
    await page.goto(`/interne/atelier?animal=${FICHE}&reseau=facebook`);
    await page.locator('#at-texte').fill(TEXTE_LONG);
    await page.locator('#at-hashtags').fill('#adoption #refuge');
    await page.getByRole('button', { name: 'Voir l’aperçu' }).click();

    const apercu = page.locator('article.apercu');
    await expect(page.getByRole('heading', { name: /Aperçu Facebook/ })).toBeVisible();
    await expect(apercu).toHaveClass(/apercu-facebook/);
    const image = apercu.locator('img.apercu-image');
    await expect(image).toHaveAttribute('width', '1200');
    await expect(image).toHaveAttribute('height', '628');
    // Sous le seuil Facebook (480 caractères) : aucune coupe.
    await expect(apercu).not.toContainText('coupé après');
    // Le lien de la fiche est cliquable sur Facebook.
    await expect(apercu.getByRole('link', { name: new RegExp(`/animaux/${FICHE}`) })).toBeVisible();
  });

  test('Facebook : dépôt puis approbation, et la limite de hashtags est appliquée', async ({ page }) => {
    await connexionInterne(page);
    await page.goto(`/interne/atelier?animal=${FICHE}&reseau=facebook`);
    // 11 hashtags : au-dessus de la limite Facebook (10).
    await page.locator('#at-texte').fill('Essai de limite.');
    await page.locator('#at-hashtags').fill(Array.from({ length: 11 }, (_, i) => `#tag${i}`).join(' '));
    await page.getByRole('button', { name: 'Déposer dans la file de validation' }).click();
    // Deux zones « alert » sont rendues (résumé général + liste détaillée) : on cible la liste.
    await expect(page.locator('.resume-erreurs ul')).toContainText('Trop de hashtags pour Facebook : 11 (maximum 10).');
    expect(new URL(page.url()).pathname).toBe('/interne/atelier/deposer');

    // Corrigé : le dépôt passe.
    const texte = `Facebook — ${TEXTE_COURT}`;
    await page.locator('#at-texte').fill(texte);
    await page.locator('#at-hashtags').fill('#adoption #refuge');
    await page.getByRole('button', { name: 'Déposer dans la file de validation' }).click();
    await expect(page.getByRole('status')).toContainText('Publication déposée');

    const post = page.locator('article.post', { hasText: texte });
    await expect(post).toHaveCount(1);
    await post.getByRole('button', { name: 'Approuver' }).click();
    await expect(page.getByRole('status')).toContainText('Post approuvé');
  });

  test('une fiche adoptée est refusée par l’atelier', async ({ page }) => {
    await connexionInterne(page);
    // Passage de la fiche en « adopté ».
    await page.goto('/interne/animaux');
    const ligne = page.getByRole('row', { name: new RegExp(FICHE) });
    await ligne.locator('select[name="statut"]').selectOption('adopte');
    await ligne.getByRole('button', { name: /Enregistrer le statut/ }).click();
    await expect(page.getByRole('status')).toContainText('Statut mis à jour.');

    const reponse = await page.goto(`/interne/atelier?animal=${FICHE}&reseau=instagram`);
    expect(reponse?.status()).toBe(422);
    await expect(page.locator('.resume-erreurs ul')).toContainText('Fiche inconnue, adoptée ou en soins.');

    // Remise à adoptable pour ne rien laisser derrière.
    await page.goto('/interne/animaux');
    const retour = page.getByRole('row', { name: new RegExp(FICHE) });
    await retour.locator('select[name="statut"]').selectOption('disponible');
    await retour.getByRole('button', { name: /Enregistrer le statut/ }).click();
    await expect(page.getByRole('status')).toContainText('Statut mis à jour.');
  });
});
