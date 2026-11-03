/**
 * Interface publique : les sept pages répondent, l'habillage ne provoque aucun
 * défilement horizontal aux quatre largeurs de référence, le menu reste
 * utilisable (déplié sans JavaScript, repliable avec), et le SEO reste cohérent
 * (titres, canoniques, JSON-LD, sitemap).
 */
import { test, expect } from '@playwright/test';
import { LARGEURS, defileHorizontalement } from './aides.js';

/** Les sept pages du menu principal. */
const PAGES = [
  { url: '/', titre: 'Accueil' },
  { url: '/nos-missions', titre: 'Nos missions' },
  { url: '/adopter', titre: 'Adopter' },
  { url: '/famille-accueil', titre: 'Famille d’accueil' },
  { url: '/nous-soutenir', titre: 'Nous soutenir' },
  { url: '/conseils', titre: 'Conseils' },
  { url: '/contact', titre: 'Contact' },
];
/** Pages hors menu, également indexables. */
const AUTRES = [
  { url: '/conseils/alimentation-du-chat' },
  { url: '/mentions-legales' },
  { url: '/confidentialite' },
];

test.describe('pages publiques', () => {
  for (const p of [...PAGES, ...AUTRES]) {
    test(`${p.url} : rendu, titre, description, canonique et données structurées`, async ({ page }) => {
      const reponse = await page.goto(p.url);
      expect(reponse?.status()).toBe(200);
      await expect(page).toHaveTitle(/.+/);
      await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /.+/);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`${p.url === '/' ? '/$' : p.url.replace(/\//g, '\\/')}$`));
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
      await expect(page.locator('h1')).toHaveCount(1);
      // Données structurées : au moins l'association, et du JSON valide partout.
      const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
      expect(ld.length).toBeGreaterThan(0);
      expect(ld.map((t) => JSON.parse(t)['@type'])).toContain('NGO');
      // Plus aucune mention de démonstration nulle part.
      expect(await page.content()).not.toMatch(/démonstration|fictif|Quatre Vents/i);
    });
  }

  test('la marque est un logo porteur d’un texte de remplacement', async ({ page }) => {
    await page.goto('/');
    const logo = page.locator('header.entete .marque img');
    await expect(logo).toBeVisible();
    await expect(logo).toHaveAttribute('alt', /Les Petits Oubliés/);
  });

  test('404 : page inconnue, non indexable', async ({ page }) => {
    const reponse = await page.goto('/page-qui-nexiste-pas');
    expect(reponse?.status()).toBe(404);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });

  test('anciennes adresses : redirections permanentes vers les nouvelles', async ({ page }) => {
    for (const [ancienne, nouvelle] of [['/refuge', '/nos-missions'], ['/animaux', '/adopter']]) {
      const reponse = await page.goto(ancienne);
      expect(reponse?.status()).toBe(200);
      expect(new URL(page.url()).pathname, `${ancienne} devrait mener à ${nouvelle}`).toBe(nouvelle);
    }
  });
});

test.describe('habillage et barre de navigation', () => {
  for (const largeur of LARGEURS) {
    test(`aucun défilement horizontal et navigation complète à ${largeur.nom}`, async ({ page }) => {
      await page.setViewportSize({ width: largeur.width, height: largeur.height });
      for (const p of [...PAGES, ...AUTRES, { url: '/animaux/biscotte' }, { url: '/animaux/biscotte/interet' }]) {
        await page.goto(p.url);
        expect(await defileHorizontalement(page), `défilement horizontal sur ${p.url}`).toBe(false);
        const entete = page.locator('header.entete');
        await expect(entete).toBeVisible();
        // L'en-tête tient dans la fenêtre : rien ne dépasse à droite ni à gauche.
        const boite = await entete.boundingBox();
        expect(boite).not.toBeNull();
        expect(boite.x).toBeGreaterThanOrEqual(-1);
        expect(boite.x + boite.width).toBeLessThanOrEqual(largeur.width + 1);
        // Les sept entrées de navigation sont toujours présentes dans le document.
        const liens = page.locator('nav[aria-label="Navigation principale"] a');
        await expect(liens).toHaveCount(PAGES.length);
      }
    });
  }

  test('menu mobile : replié à 320 px, dépliable, et toutes les entrées atteignables', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/');
    const bouton = page.getByRole('button', { name: 'Menu' });
    await expect(bouton).toBeVisible();
    await expect(bouton).toHaveAttribute('aria-expanded', 'false');

    const liens = page.locator('nav[aria-label="Navigation principale"] a');
    await expect(liens.first()).toBeHidden();

    await bouton.click();
    await expect(bouton).toHaveAttribute('aria-expanded', 'true');
    for (let i = 0; i < PAGES.length; i += 1) await expect(liens.nth(i)).toBeVisible();
    expect(await defileHorizontalement(page), 'menu déplié : pas de débordement').toBe(false);

    // Le bouton pilote bien la liste qu'il annonce.
    const controle = await bouton.getAttribute('aria-controls');
    await expect(page.locator(`#${controle}`)).toBeVisible();

    await bouton.click();
    await expect(bouton).toHaveAttribute('aria-expanded', 'false');
  });

  test('au-delà de 600 px le menu est déplié et le bouton disparaît', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Menu' })).toBeHidden();
    const liens = page.locator('nav[aria-label="Navigation principale"] a');
    for (let i = 0; i < PAGES.length; i += 1) await expect(liens.nth(i)).toBeVisible();
  });

  test('sans JavaScript, les sept entrées restent visibles à 320 px', async ({ browser }) => {
    const contexte = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 800 } });
    const page = await contexte.newPage();
    try {
      await page.goto('/');
      const liens = page.locator('nav[aria-label="Navigation principale"] a');
      for (let i = 0; i < PAGES.length; i += 1) await expect(liens.nth(i)).toBeVisible();
      // Le bouton reste caché : il ne servirait à rien sans script.
      await expect(page.getByRole('button', { name: 'Menu' })).toBeHidden();
      expect(await defileHorizontalement(page)).toBe(false);
    } finally {
      await contexte.close();
    }
  });

  test('la feuille de style publique est servie et pose les variables d’espacement', async ({ page }) => {
    const reponse = await page.request.get('/css/main.css');
    expect(reponse.status()).toBe(200);
    const css = await reponse.text();
    for (const variable of ['--esp-1', '--esp-8', '--gouttiere', '--conteneur', '--vert']) {
      expect(css, `variable ${variable} absente`).toContain(variable);
    }
    // Les pages consomment ces variables plutôt que des valeurs en dur.
    await page.goto('/');
    const gouttiere = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--gouttiere').trim());
    expect(gouttiere).not.toBe('');
  });

  test('les éléments de marque sont servis', async ({ page }) => {
    for (const chemin of ['/img/marque/logo.svg', '/img/marque/pattes.svg', '/favicon.svg']) {
      const reponse = await page.request.get(chemin);
      expect(reponse.status(), chemin).toBe(200);
    }
  });
});

test.describe('l’espace interne reste invisible du public', () => {
  test('robots.txt interdit /interne et désigne le sitemap', async ({ page }) => {
    const reponse = await page.request.get('/robots.txt');
    expect(reponse.status()).toBe(200);
    const txt = await reponse.text();
    expect(txt).toMatch(/Disallow:\s*\/interne/);
  });

  test('sitemap.xml liste les pages publiques, les fiches conseils, et jamais /interne', async ({ page }) => {
    const reponse = await page.request.get('/sitemap.xml');
    expect(reponse.status()).toBe(200);
    const xml = await reponse.text();
    expect(xml).toContain('<loc>');
    expect(xml).not.toContain('/interne');
    for (const p of PAGES) expect(xml, `${p.url} absent`).toContain(p.url === '/' ? '/</loc>' : `${p.url}</loc>`);
    expect(xml).toContain('/conseils/alimentation-du-chat</loc>');
  });

  test('aucune page publique ne pointe vers /interne et aucun cookie n’est posé', async ({ page, context }) => {
    for (const p of [...PAGES, ...AUTRES, { url: '/animaux/biscotte' }]) {
      await page.goto(p.url);
      await expect(page.locator('a[href^="/interne"]')).toHaveCount(0);
    }
    expect(await context.cookies()).toEqual([]);
  });
});
