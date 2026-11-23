/**
 * Régressions d'interface et de confort d'usage, mesurées dans le navigateur :
 * taille des cibles (RGAA 13.1 / WCAG 2.5.8), champs réellement habillés,
 * menu replié de l'espace interne, cellules de tableau sur mobile et
 * aperçu des publications au bon cadrage.
 * Ces vérifications portent sur des valeurs calculées, pas sur le code source :
 * une feuille de style oubliée les fait échouer.
 */
import { test, expect } from '@playwright/test';
import { connexionInterne, defileHorizontalement } from './aides.js';

/** Encombrement réel d'un élément, arrondi au pixel. */
const boite = (loc) => loc.evaluate((el) => {
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  return {
    largeur: Math.round(r.width), hauteur: Math.round(r.height), x: Math.round(r.x),
    police: s.fontSize, bordure: s.borderWidth, ratio: s.aspectRatio, remplissage: s.objectFit,
  };
});

test.describe('taille des cibles (RGAA 13.1)', () => {
  // Un lien seul dans une liste ou dans un paragraphe n'est pas un lien
  // « en ligne dans une phrase » : l'exception de WCAG 2.5.8 ne s'applique pas.
  const CAS = [
    ['/introuvable', 'Retourner à l’accueil'],
    ['/introuvable', 'Devenir famille d’accueil'],
    ['/mentions-legales', 'Retour à l’accueil'],
    ['/confidentialite', 'Retour à l’accueil'],
    ['/', 'Voir tous les animaux à adopter'],
    ['/animaux/biscotte/interet', 'Retour à la fiche de Biscotte'],
    ['/conseils/alimentation-du-chat', 'Retour aux fiches conseils'],
  ];

  for (const [url, intitule] of CAS) {
    test(`« ${intitule} » sur ${url} fait au moins 24 px de haut`, async ({ page }) => {
      await page.goto(url);
      const b = await boite(page.getByRole('link', { name: intitule, exact: true }).first());
      expect(b.hauteur, `${intitule} : ${b.largeur}×${b.hauteur}`).toBeGreaterThanOrEqual(24);
    });
  }

  test('les liens des listes du tableau de bord atteignent la cible', async ({ page }) => {
    await connexionInterne(page);
    const liens = page.locator('.liste-liens a');
    const n = await liens.count();
    expect(n, 'le tableau de bord expose au moins une liste de liens').toBeGreaterThan(0);
    for (let i = 0; i < n; i += 1) {
      const b = await boite(liens.nth(i));
      expect(b.hauteur, `lien ${i} : ${b.largeur}×${b.hauteur}`).toBeGreaterThanOrEqual(24);
    }
  });
});

test.describe('calculateur des fiches conseils', () => {
  const CHAMPS = ['glu-proteines', 'glu-grasses', 'glu-cendres', 'glu-fibres', 'glu-humidite'];

  test('les champs « nombre » sont habillés comme les autres champs du site', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 900 });
    await page.goto('/conseils/alimentation-du-chat');
    await expect(page.locator('[data-calculateur-glucides]')).toBeVisible();
    for (const id of CHAMPS) {
      const b = await boite(page.locator(`#${id}`));
      // `input[type=number]` n'héritait d'aucune règle : 59 × 21 px en police 13 px.
      expect(b.hauteur, `${id} : hauteur ${b.hauteur}`).toBeGreaterThanOrEqual(44);
      expect(b.largeur, `${id} : largeur ${b.largeur}`).toBeGreaterThanOrEqual(44);
      expect(b.police, `${id} : police ${b.police}`).toBe('16px');
      expect(b.bordure, `${id} : bordure ${b.bordure}`).toBe('2px');
    }
  });
});

test.describe('espace interne : menu replié', () => {
  test('à 360 px le menu est replié derrière un bouton, et Échap le referme', async ({ page }) => {
    await connexionInterne(page);
    await page.setViewportSize({ width: 360, height: 900 });
    await page.goto('/interne');

    const bouton = page.getByRole('button', { name: 'Menu' });
    await expect(bouton).toBeVisible();
    await expect(bouton).toHaveAttribute('aria-expanded', 'false');

    const liens = page.locator('nav[aria-label="Navigation de l’espace interne"] a');
    await expect(liens.first()).toBeHidden();
    // Dix entrées empilées occupaient 476 px avant le contenu.
    const nav = page.locator('nav[aria-label="Navigation de l’espace interne"]');
    expect((await boite(nav)).hauteur, 'menu replié').toBeLessThan(24);

    await bouton.click();
    await expect(bouton).toHaveAttribute('aria-expanded', 'true');
    await expect(liens.first()).toBeVisible();
    expect(await defileHorizontalement(page), 'menu déplié : pas de débordement').toBe(false);

    await liens.first().press('Escape');
    await expect(bouton).toHaveAttribute('aria-expanded', 'false');
    await expect(bouton).toBeFocused();
  });

  test('à 1280 px le menu est déplié et le bouton disparaît', async ({ page }) => {
    await connexionInterne(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/interne');
    await expect(page.getByRole('button', { name: 'Menu' })).toBeHidden();
    await expect(page.locator('nav[aria-label="Navigation de l’espace interne"] a').first()).toBeVisible();
  });

  test('sans JavaScript, les dix entrées restent atteignables', async ({ browser }) => {
    const contexte = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 360, height: 900 } });
    const page = await contexte.newPage();
    try {
      await connexionInterne(page);
      await page.goto('/interne');
      await expect(page.getByRole('button', { name: 'Menu' })).toBeHidden();
      const liens = page.locator('nav[aria-label="Navigation de l’espace interne"] a');
      expect(await liens.count()).toBeGreaterThanOrEqual(9);
      await expect(liens.first()).toBeVisible();
    } finally {
      await contexte.close();
    }
  });

  test('le bandeau d’information est dans un point de repère', async ({ page }) => {
    await connexionInterne(page);
    const dans = await page.locator('.bandeau-interne').evaluate(
      (el) => !!el.closest('header, main, footer, nav, aside, [role="banner"]'),
    );
    expect(dans, 'le bandeau doit appartenir à un point de repère').toBe(true);
  });
});

test.describe('espace interne : cellules de tableau sur mobile', () => {
  for (const largeur of [320, 360, 768]) {
    test(`à ${largeur} px les champs d’une cellule d’actions occupent la largeur utile`, async ({ page }) => {
      await connexionInterne(page);
      await page.setViewportSize({ width: largeur, height: 900 });
      await page.goto('/interne/animaux');

      const cellule = page.locator('td.cellule-actions').first();
      const c = await boite(cellule);
      const select = await boite(cellule.locator('select').first());
      const bouton = await boite(cellule.locator('button').first());

      // La grille à deux colonnes recevait trois enfants : le formulaire
      // retombait dans la colonne d'étiquette de 144 px.
      expect(select.largeur, `select ${select.largeur} / cellule ${c.largeur}`)
        .toBeGreaterThan(Math.min(c.largeur, 240) * 0.8);
      expect(select.hauteur).toBeGreaterThanOrEqual(44);
      // Un bouton de 68 px de haut signalait un intitulé replié sur trois lignes.
      expect(bouton.hauteur, `bouton ${bouton.largeur}×${bouton.hauteur}`).toBeLessThanOrEqual(48);
      expect(await defileHorizontalement(page)).toBe(false);
    });
  }

  test('l’étiquette de chaque cellule reste lisible au-dessus de sa valeur', async ({ page }) => {
    await connexionInterne(page);
    await page.setViewportSize({ width: 360, height: 900 });
    await page.goto('/interne/animaux');
    // L'en-tête de colonne est masqué visuellement : `data-label` le remplace.
    const etiquette = await page.locator('td[data-label="Espèce"]').first()
      .evaluate((el) => getComputedStyle(el, '::before').content);
    expect(etiquette).toContain('Espèce');
  });
});

test.describe('atelier : aperçu au cadrage du réseau', () => {
  const CADRAGES = [
    ['instagram', '1:1', '1 / 1'],
    ['instagram', '4:5', '4 / 5'],
    ['facebook', '1:1', '1.91 / 1'],
  ];

  for (const [reseau, cadrage, ratio] of CADRAGES) {
    test(`${reseau} ${cadrage} : l’image est recadrée en ${ratio}`, async ({ page }) => {
      await connexionInterne(page);
      await page.goto(`/interne/atelier?animal=biscotte&reseau=${reseau}&cadrage=${encodeURIComponent(cadrage)}&gabarit=arrivee`);
      await page.locator('#at-texte').fill('Aperçu de contrôle pour vérifier le cadrage de l’image et l’habillage de la carte.');
      await page.getByRole('button', { name: 'Voir l’aperçu' }).click();

      const image = page.locator('.apercu-image');
      await expect(image).toBeVisible();
      const b = await boite(image);
      // Sans habillage, l'image s'affichait au ratio 4/3 de la source, étirée.
      expect(b.ratio, `ratio obtenu : ${b.ratio}`).toBe(ratio);
      expect(b.remplissage, 'l’image doit être recadrée, pas déformée').toBe('cover');
    });
  }

  test('la carte d’aperçu est visiblement encadrée', async ({ page }) => {
    await connexionInterne(page);
    await page.goto('/interne/atelier?animal=biscotte&reseau=instagram&gabarit=arrivee');
    await page.locator('#at-texte').fill('Aperçu de contrôle de l’encadrement de la carte.');
    await page.getByRole('button', { name: 'Voir l’aperçu' }).click();
    const style = await page.locator('.apercu').evaluate((el) => {
      const s = getComputedStyle(el);
      return { bordure: s.borderWidth, fond: s.backgroundColor, remplissage: s.paddingTop };
    });
    expect(parseFloat(style.bordure), 'bordure de la carte').toBeGreaterThan(0);
    expect(parseFloat(style.remplissage), 'marge intérieure de la carte').toBeGreaterThan(0);
    expect(style.fond).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('les erreurs de l’atelier sont annoncées avec un titre et reçoivent le focus', async ({ page }) => {
    await connexionInterne(page);
    await page.goto('/interne/atelier');
    await page.locator('#at-texte').fill('Texte sans fiche sélectionnée.');
    await page.getByRole('button', { name: 'Voir l’aperçu' }).click();
    const resume = page.locator('.resume-erreurs[role="alert"]');
    // Un seul message d'alerte : le bandeau générique doublait la liste
    // d'erreurs, et les deux se disputaient la prise de focus.
    await expect(resume).toHaveCount(1);
    await expect(resume).toBeVisible();
    await expect(resume.getByRole('heading')).toBeVisible();
    await expect(resume).toBeFocused();
    await expect(page.locator('[data-focus-initial]')).toHaveCount(1);
  });
});

test.describe('résumé d’erreurs des formulaires publics', () => {
  test('un message long garde une hauteur de ligne normale', async ({ page }) => {
    await page.goto('/contact');
    await page.setViewportSize({ width: 360, height: 900 });
    // Envoi vide : le serveur renvoie le résumé d'erreurs avec ses liens d'ancre.
    await page.evaluate(() => {
      const f = document.querySelector('form[data-validation]');
      f.setAttribute('novalidate', '');
      f.querySelectorAll('[required]').forEach((el) => el.removeAttribute('required'));
      f.removeAttribute('data-validation');
      f.submit();
    });
    const lien = page.locator('.resume-erreurs a').first();
    await expect(lien).toBeVisible();
    const h = await lien.evaluate((el) => {
      const s = getComputedStyle(el);
      return { ligne: s.lineHeight, hauteur: Math.round(el.getBoundingClientRect().height) };
    });
    // Une interligne de 44 px disloquait les messages repliés sur deux lignes.
    expect(parseFloat(h.ligne), `interligne ${h.ligne}`).toBeLessThan(32);
    expect(h.hauteur, `cible ${h.hauteur}`).toBeGreaterThanOrEqual(24);
  });
});
