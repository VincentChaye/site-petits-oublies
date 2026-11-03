/**
 * Parcours « suivi des demandes » : envoyer le formulaire d'intérêt depuis une fiche
 * publique, retrouver la demande sur /interne/soumissions, la passer de « nouvelle »
 * à « traitée » avec une note interne, vérifier le filtre par statut, puis retrouver
 * statut et note dans l'export CSV.
 */
import { test, expect } from '@playwright/test';
import { connexionInterne, envoyerFormulairePublic } from './aides.js';

const PRENOM = 'Camille-E2E';
const EMAIL = 'camille.e2e@exemple.test';
const NOTE = 'Appelée le 3 novembre : visite prévue samedi matin.';
const FICHE = 'biscotte';

test.describe.serial('suivi des demandes', () => {
  test('le formulaire d’intérêt public enregistre la demande, rattachée à la fiche', async ({ page }) => {
    await page.goto(`/animaux/${FICHE}`);
    await page.getByRole('link', { name: 'Parler de mon projet d’adoption' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Biscotte/);

    await page.locator('#formulaire-interet-prenom').fill(PRENOM);
    await page.locator('#formulaire-interet-email').fill(EMAIL);
    await page.locator('#formulaire-interet-telephone').fill('06 12 34 56 78');
    await page.locator('#formulaire-interet-logement').fill('Maison avec jardin clos, en périphérie, télétravail trois jours par semaine.');
    await page.locator('#formulaire-interet-message').fill('Bonjour, je souhaite rencontrer Biscotte. Merci !');
    await page.locator('#formulaire-interet-consentement').check();
    // Le champ piège doit rester vide : il n'est même pas atteignable au clavier.
    await expect(page.locator('#formulaire-interet-site_web')).toHaveValue('');

    await envoyerFormulairePublic(page, "Envoyer mon projet d'adoption");
    await expect(page.getByRole('status')).toContainText("votre projet d'adoption a bien été enregistré");
    // Aucun cookie n'est posé par une route publique, même après un POST.
    expect(await page.context().cookies()).toEqual([]);
  });

  test('de « nouvelle » à « traitée » avec une note, puis filtre par statut', async ({ page }) => {
    await connexionInterne(page);
    await page.getByRole('link', { name: 'Demandes' }).click();
    await expect(page.getByRole('heading', { name: 'Soumissions des formulaires' })).toBeVisible();

    const ligne = page.getByRole('row', { name: new RegExp(PRENOM) });
    await expect(ligne).toHaveCount(1);
    const suivi = ligne.locator('td[data-label="Suivi"]');
    await expect(suivi.locator('select')).toHaveValue('nouvelle');

    await suivi.locator('select').selectOption('traitee');
    await suivi.locator('textarea').fill(NOTE);
    await suivi.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByRole('status')).toContainText('Suivi de la demande enregistré.');

    // La valeur est bien persistée.
    const apres = page.getByRole('row', { name: new RegExp(PRENOM) });
    await expect(apres.locator('td[data-label="Suivi"] select')).toHaveValue('traitee');
    await expect(apres.locator('td[data-label="Suivi"] textarea')).toHaveValue(NOTE);

    // Filtre « traitée » : la demande est là. Filtre « nouvelle » : elle n'y est plus.
    await page.locator('#filtre-statut').selectOption('traitee');
    await page.getByRole('button', { name: 'Filtrer' }).click();
    await expect(page.getByRole('row', { name: new RegExp(PRENOM) })).toHaveCount(1);

    await page.locator('#filtre-statut').selectOption('nouvelle');
    await page.getByRole('button', { name: 'Filtrer' }).click();
    await expect(page.getByRole('row', { name: new RegExp(PRENOM) })).toHaveCount(0);

    // Un statut inconnu dans l'URL : message en français, pas de plantage.
    const reponse = await page.goto('/interne/soumissions?type=interet&statut=inconnu');
    expect(reponse?.status()).toBe(422);
    await expect(page.getByRole('alert')).toContainText('statut inconnu');
  });

  test('l’export CSV contient Statut, Note et Modifiée le, sans injection de formule', async ({ page }) => {
    await connexionInterne(page);
    const reponse = await page.request.get('/interne/soumissions/export.csv?type=interet');
    expect(reponse.status()).toBe(200);
    expect(reponse.headers()['content-type']).toContain('text/csv');
    expect(reponse.headers()['content-disposition']).toContain('soumissions-interet.csv');

    const csv = await reponse.text();
    const entetes = csv.replace(/^﻿/, '').split(/\r?\n/)[0];
    for (const colonne of ['Statut', 'Note', 'Modifiée le']) expect(entetes).toContain(colonne);
    expect(csv).toContain(PRENOM);
    expect(csv).toContain('Traitée');
    expect(csv).toContain(NOTE);
    // Aucune cellule ne commence par un caractère déclenchant une formule.
    for (const cellule of csv.split(/[,\r\n]/)) expect(cellule.trimStart()).not.toMatch(/^"?[=+\-@]/);
  });

  test('le tableau de bord compte la demande sur la fiche concernée', async ({ page }) => {
    await connexionInterne(page);
    const corps = page.locator('main');
    await expect(corps).toContainText('7 derniers jours');
    await expect(corps).toContainText('30 derniers jours');
    await expect(corps).toContainText('Projets d’adoption');
    // Biscotte a reçu la demande du premier test : colonne « Demandes » à 1.
    const ligne = page.getByRole('row', { name: /Biscotte/ });
    await expect(ligne.locator('td[data-label="Demandes"]')).toHaveText('1');
    // La liste des fiches disponibles sans demande ne contient donc pas Biscotte.
    const sansDemande = page.locator('section[aria-labelledby="titre-demandes"]');
    await expect(sansDemande.getByRole('link', { name: 'Biscotte' })).toHaveCount(0);
  });
});
