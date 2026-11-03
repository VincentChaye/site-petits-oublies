/**
 * Parcours « fiches animaux » : créer une fiche depuis /interne, la voir apparaître
 * sur /animaux, la modifier, puis la marquer adoptée et la voir disparaître du public.
 * Couvre aussi le refus d'une saisie invalide et celui d'un slug déjà utilisé.
 */
import { test, expect } from '@playwright/test';
import { connexionInterne } from './aides.js';

const SLUG = 'e2e-pirouette';
const NOM = 'Pirouette';

/** Remplit le formulaire de fiche (création ou modification). */
async function remplirFiche(page, { nom = NOM, slug = SLUG, creation = true, caractere, photo = true } = {}) {
  if (creation) await page.locator('#slug').fill(slug);
  await page.locator('#nom').fill(nom);
  await page.locator('#espece').selectOption('chat');
  await page.locator('#tranche').selectOption('jeune');
  await page.locator('#taille').selectOption('petit');
  await page.locator('#sexe').selectOption('femelle');
  await page.locator('#statut').selectOption('disponible');
  await page.locator('#race').fill('européenne');
  await page.locator('#age').fill('2');
  await page.locator('#dateArrivee').fill('2026-10-01');
  await page.locator('#caractere').fill(caractere ?? 'Vive, curieuse et très joueuse ; elle réclame des câlins dès le matin.');
  await page.locator('#besoins').fill('Un intérieur calme, un arbre à chat et des jeux quotidiens.');
  await page.locator('#histoire').fill('Arrivée au refuge après une portée non désirée, elle a vite pris ses aises.');
  if (photo) {
    await page.locator('#photo_src').fill('/img/animaux/luna-1.svg');
    await page.locator('#photo_alt').fill('Illustration d’une jeune chatte tigrée assise, les oreilles dressées');
  }
}

test.describe.serial('fiches animaux depuis l’espace interne', () => {
  test('création : la fiche apparaît dans la liste interne puis sur /animaux', async ({ page }) => {
    await connexionInterne(page);
    await page.getByRole('link', { name: 'Fiches animaux' }).click();
    await page.getByRole('link', { name: 'Créer une fiche' }).click();
    await expect(page.getByRole('heading', { name: 'Nouvelle fiche animal' })).toBeVisible();

    await remplirFiche(page);
    await page.getByRole('button', { name: 'Enregistrer' }).click();

    await expect(page.getByRole('status')).toContainText('Fiche créée.');
    await expect(page.getByRole('row', { name: new RegExp(SLUG) })).toBeVisible();

    // Visible côté public, avec sa fiche détaillée.
    await page.goto('/animaux');
    await expect(page.getByRole('link', { name: new RegExp(NOM) }).first()).toBeVisible();
    await page.goto(`/animaux/${SLUG}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(NOM);
    await expect(page.getByRole('link', { name: 'Cet animal m’intéresse' })).toBeVisible();
  });

  test('slug déjà utilisé : refus explicite en français, aucune fiche ajoutée', async ({ page }) => {
    await connexionInterne(page);
    await page.goto('/interne/animaux/nouveau');
    await remplirFiche(page, { nom: 'Doublon' });
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByRole('alert')).toContainText('déjà utilisé');
    await page.goto('/interne/animaux');
    await expect(page.getByRole('row', { name: new RegExp(SLUG) })).toHaveCount(1);
  });

  test('saisie invalide : la fiche n’est pas enregistrée et les erreurs sont listées', async ({ page }) => {
    await connexionInterne(page);
    await page.goto('/interne/animaux/nouveau');
    // Le navigateur laisse passer ces valeurs (type texte) : c'est le serveur qui refuse.
    await remplirFiche(page, { nom: 'Refusée', slug: 'Slug Invalide !' });
    await page.locator('#photo_src').fill('https://ailleurs.example/photo.jpg');
    await page.getByRole('button', { name: 'Enregistrer' }).click();

    const resume = page.getByRole('alert');
    await expect(resume).toContainText('n’a pas été enregistrée');
    await expect(resume.getByRole('listitem').first()).toBeVisible();
    // Les valeurs saisies sont réaffichées : la page ne se vide pas.
    await expect(page.locator('#nom')).toHaveValue('Refusée');

    await page.goto('/interne/animaux');
    await expect(page.getByRole('row', { name: /Refusée/ })).toHaveCount(0);
  });

  test('modification : le nouveau caractère est visible sur la fiche publique', async ({ page }) => {
    const caractere = 'Caractère mis à jour par le test de bout en bout : douce et bavarde.';
    await connexionInterne(page);
    await page.goto(`/interne/animaux/${SLUG}/modifier`);
    await expect(page.locator('#slug')).toHaveValue(SLUG);
    await remplirFiche(page, { creation: false, caractere });
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByRole('status')).toContainText('Fiche enregistrée.');

    await page.goto(`/animaux/${SLUG}`);
    await expect(page.locator('main')).toContainText(caractere);
  });

  test('bascule adopté : la fiche quitte /animaux, le formulaire d’intérêt redirige', async ({ page }) => {
    await connexionInterne(page);
    await page.goto('/interne/animaux');
    const ligne = page.getByRole('row', { name: new RegExp(SLUG) });
    await ligne.getByRole('button', { name: /Marquer adopté/ }).click();
    await expect(page.getByRole('status')).toContainText('Statut mis à jour.');
    await expect(ligne).toContainText('Adopté');

    await page.goto('/animaux');
    await expect(page.getByRole('link', { name: new RegExp(`^${NOM}`) })).toHaveCount(0);
    await page.goto(`/animaux/${SLUG}/interet`);
    expect(new URL(page.url()).pathname).toBe(`/animaux/${SLUG}`);

    // Retour à « disponible » : la fiche revient côté public.
    await page.goto('/interne/animaux');
    await page.getByRole('row', { name: new RegExp(SLUG) }).getByRole('button', { name: /Marquer disponible/ }).click();
    await expect(page.getByRole('status')).toContainText('Statut mis à jour.');
    await page.goto('/animaux');
    await expect(page.getByRole('link', { name: new RegExp(NOM) }).first()).toBeVisible();
  });
});
