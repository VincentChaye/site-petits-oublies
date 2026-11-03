/**
 * Parcours « Nous soutenir » : envoyer une adhésion depuis la page publique,
 * la retrouver sur /interne/soumissions, l'exporter en CSV avec les nouvelles
 * colonnes, et gérer besoins et collectes depuis /interne/soutien.
 */
import { test, expect } from '@playwright/test';
import { connexionInterne, envoyerFormulairePublic } from './aides.js';

const NOM = 'Lefevre-E2E';
const PRENOM = 'Zoé';
const EMAIL = 'zoe.e2e@exemple.test';
const BESOIN = 'Caisses de transport E2E';
const LIEU = 'Animalerie de la Gare E2E';

/** Date ISO décalée de `jours` par rapport à aujourd'hui. */
const dateDans = (jours) => new Date(Date.now() + jours * 86400000).toISOString().slice(0, 10);

/** Remplit le formulaire d'adhésion avec les valeurs communes. */
async function remplirAdhesion(page, { formule }) {
  await page.locator('#formulaire-adhesion-nom').fill(NOM);
  await page.locator('#formulaire-adhesion-prenom').fill(PRENOM);
  await page.locator('#formulaire-adhesion-adresse').fill('1 rue des Lilas, 91390 Morsang-sur-Orge');
  await page.locator('#formulaire-adhesion-telephone').fill('06 20 79 27 08');
  await page.locator('#formulaire-adhesion-email').fill(EMAIL);
  await page.locator('#formulaire-adhesion-formule').selectOption(formule);
  await page.locator('#formulaire-adhesion-consentement').check();
}

test.describe.serial('adhésion et suivi interne', () => {
  test('adhésion jeune sans représentant légal : refusée, en français', async ({ page }) => {
    await page.goto('/nous-soutenir');
    await remplirAdhesion(page, { formule: 'adhesion_jeune' });
    await envoyerFormulairePublic(page, 'Envoyer ma demande');

    await expect(page.getByRole('alert')).toContainText('Vérifiez les champs signalés');
    await expect(page.getByRole('alert')).toContainText('représentant légal');
    // Aucun cookie n'est posé par une route publique, même après un POST refusé.
    expect(await page.context().cookies()).toEqual([]);
  });

  test('adhésion jeune complète : acceptée, avec reçu fiscal et accord photos', async ({ page }) => {
    await page.goto('/nous-soutenir');
    await remplirAdhesion(page, { formule: 'adhesion_jeune' });
    await page.locator('#formulaire-adhesion-representant_nom').fill('Lefevre');
    await page.locator('#formulaire-adhesion-representant_prenom').fill('Marie');
    await page.locator('#formulaire-adhesion-representant_accord').check();
    await page.locator('#formulaire-adhesion-recu_fiscal').check();
    await page.locator('#formulaire-adhesion-photos').check();

    await envoyerFormulairePublic(page, 'Envoyer ma demande');
    await expect(page.getByRole('status')).toContainText("Aucun paiement n'a été effectué");
  });

  test('les deux consentements sont des cases distinctes, jamais pré-cochées', async ({ page }) => {
    await page.goto('/nous-soutenir');
    const photos = page.locator('#formulaire-adhesion-photos');
    const recontact = page.locator('#formulaire-adhesion-consentement');
    await expect(photos).not.toBeChecked();
    await expect(recontact).not.toBeChecked();
    // Cocher l'une n'entraîne pas l'autre.
    await recontact.check();
    await expect(photos).not.toBeChecked();
  });

  test('mention RGPD et absence de coordonnées bancaires inventées', async ({ page }) => {
    await page.goto('/nous-soutenir');
    await expect(page.locator('.rgpd').first()).toContainText('Conservation : 12 mois');
    await expect(page.locator('.rgpd').first().getByRole('link', { name: /politique de confidentialité/i })).toBeVisible();
    // Tant que l'IBAN n'est pas renseigné, le site l'annonce au lieu d'en inventer un.
    const marqueur = page.locator('.a-completer');
    if (await marqueur.count()) {
      await expect(marqueur).toContainText('À compléter');
      expect(await page.content()).not.toMatch(/IBAN\s+FR\d/);
    }
  });

  test('la demande apparaît dans l’espace interne et dans l’export CSV', async ({ page }) => {
    await connexionInterne(page);
    await page.goto('/interne/soumissions?type=adhesion');
    await expect(page.getByRole('heading', { name: 'Soumissions des formulaires' })).toBeVisible();

    const ligne = page.getByRole('row', { name: new RegExp(NOM) });
    await expect(ligne).toHaveCount(1);

    // Suivi : passage en « traitée » avec une note.
    const suivi = ligne.locator('td[data-label="Suivi"]');
    await suivi.locator('select').selectOption('traitee');
    await suivi.locator('textarea').fill('Chèque reçu, reçu fiscal envoyé.');
    await suivi.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByRole('status')).toContainText('Suivi de la demande enregistré.');

    const reponse = await page.request.get('/interne/soumissions/export.csv?type=adhesion');
    expect(reponse.status()).toBe(200);
    expect(reponse.headers()['content-disposition']).toContain('soumissions-adhesion.csv');
    const csv = await reponse.text();
    const entetes = csv.replace(/^﻿/, '').split(/\r?\n/)[0];
    for (const colonne of ['Accord du représentant légal', 'Reçu fiscal demandé', 'Publication de photos acceptée', 'Statut', 'Note']) {
      expect(entetes, `colonne « ${colonne} » absente`).toContain(colonne);
    }
    expect(csv).toContain(NOM);
    expect(csv).toContain('Traitée');
    // Aucune cellule ne commence par un caractère déclenchant une formule.
    for (const cellule of csv.split(/[,\r\n]/)) expect(cellule.trimStart()).not.toMatch(/^"?[=+\-@]/);
  });
});

test.describe.serial('besoins et collectes depuis l’espace interne', () => {
  test('ajouter un besoin : visible aussitôt sur la page publique', async ({ page }) => {
    await connexionInterne(page);
    await page.getByRole('link', { name: 'Besoins et collectes' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Besoins et collectes' })).toBeVisible();

    await page.locator('#besoin-titre').fill(BESOIN);
    await page.locator('#besoin-detail').fill('Toutes tailles, en bon état.');
    await page.getByRole('button', { name: 'Ajouter le besoin' }).click();
    await expect(page.getByRole('status')).toContainText('Besoin ajouté');

    await page.goto('/nous-soutenir');
    await expect(page.locator('#materiel')).toContainText(BESOIN);
  });

  test('une collecte à venir s’affiche, une collecte passée est masquée', async ({ page }) => {
    await connexionInterne(page);
    await page.goto('/interne/soutien');

    const ajouter = async (date, lieu) => {
      await page.locator('#collecte-date').fill(date);
      await page.locator('#collecte-lieu').fill(lieu);
      await page.locator('#collecte-ville').fill('Morsang-sur-Orge');
      await page.locator('#collecte-horaires').fill('10 h – 18 h');
      await page.getByRole('button', { name: 'Ajouter la collecte' }).click();
      await expect(page.getByRole('status')).toContainText('Collecte ajoutée');
    };
    await ajouter(dateDans(30), LIEU);
    await ajouter(dateDans(-30), `${LIEU} (passée)`);

    // L'équipe voit les deux, dont une signalée comme passée.
    await expect(page.locator('main')).toContainText('Passée : masquée du site');

    await page.goto('/nous-soutenir');
    await expect(page.locator('#collectes')).toContainText(LIEU);
    await expect(page.locator('#collectes')).not.toContainText('(passée)');
  });

  test('date invalide refusée en français, sans rien écrire', async ({ page }) => {
    await connexionInterne(page);
    await page.goto('/interne/soutien');
    // Le champ `type="date"` empêche la saisie libre dans le navigateur : le refus serveur
    // se vérifie donc par une requête directe, jeton CSRF et version à l'appui.
    const html = await (await page.request.get('/interne/soutien')).text();
    const csrf = /name="_csrf" value="([^"]+)"/.exec(html)[1];
    const version = /name="_version" value="([^"]+)"/.exec(html)[1];

    const reponse = await page.request.post('/interne/soutien/collectes', {
      form: { _csrf: csrf, _version: version, date: '12/12/2026', lieu: 'Sans date E2E' },
    });
    expect(reponse.status()).toBe(422);
    expect(await reponse.text()).toMatch(/AAAA-MM-JJ/);

    await page.goto('/nous-soutenir');
    await expect(page.locator('main')).not.toContainText('Sans date E2E');
  });

  test('suppression : le besoin et les collectes quittent le site', async ({ page }) => {
    await connexionInterne(page);
    await page.goto('/interne/soutien');

    await page.getByRole('row', { name: new RegExp(BESOIN) }).getByRole('button', { name: /Supprimer/ }).click();
    await expect(page.getByRole('status')).toContainText('Besoin supprimé');

    // Toutes les collectes de ce parcours.
    for (let i = 0; i < 2; i += 1) {
      const ligne = page.getByRole('row', { name: new RegExp(LIEU) }).first();
      if (!(await ligne.count())) break;
      await ligne.getByRole('button', { name: /Supprimer/ }).click();
      await expect(page.getByRole('status')).toContainText('Collecte supprimée');
    }

    await page.goto('/nous-soutenir');
    await expect(page.locator('main')).not.toContainText(BESOIN);
    await expect(page.locator('main')).not.toContainText(LIEU);
  });
});
