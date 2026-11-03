/**
 * Aides partagées : connexion à l'espace interne, envoi d'un formulaire public
 * (délai anti-robot respecté), audit axe-core et mesure du défilement horizontal.
 * @module tests/e2e/aides
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { expect } from '@playwright/test';
import { INTERNAL_SECRET } from './environnement.js';

const require_ = createRequire(import.meta.url);
/** Source d'axe-core, injectée avant les scripts de la page (la CSP interdit `addScriptTag`). */
const SOURCE_AXE = readFileSync(path.join(path.dirname(require_.resolve('axe-core/package.json')), 'axe.min.js'), 'utf8');

/** Délai minimal imposé par le jeton anti-robot des formulaires publics (3 s). */
export const DELAI_ANTIROBOT_MS = 3_200;

/** Se connecte à l'espace interne et laisse la page sur le tableau de bord. */
export async function connexionInterne(page) {
  await page.goto('/interne/connexion');
  await page.getByLabel('Secret').fill(INTERNAL_SECRET);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/interne');
}

/**
 * Attend le délai anti-robot puis clique le bouton d'envoi d'un formulaire public.
 * Le jeton est horodaté au rendu de la page : envoyer trop vite est refusé.
 */
export async function envoyerFormulairePublic(page, nomBouton) {
  await page.waitForTimeout(DELAI_ANTIROBOT_MS);
  await page.getByRole('button', { name: nomBouton }).click();
}

/**
 * Rend axe-core disponible dans toutes les pages chargées ensuite par cet onglet.
 * Passe par `addInitScript` : la CSP du site interdit `addScriptTag`.
 */
export async function injecterAxe(page) {
  await page.addInitScript({ content: SOURCE_AXE });
}

/**
 * Lance axe-core sur la page courante (appeler `injecterAxe` avant la navigation).
 * @returns {Promise<Array<{id: string, impact: string, noeuds: number, aide: string}>>}
 *   Violations d'impact `critical` ou `serious`.
 */
export async function violationsGraves(page) {
  const resultat = await page.evaluate(() => window.axe.run(document, {
    resultTypes: ['violations'],
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  }));
  return resultat.violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map((v) => ({ id: v.id, impact: v.impact, noeuds: v.nodes.length, aide: v.help }));
}

/** Vrai si la page défile horizontalement (tolérance de 1 px pour les arrondis). */
export async function defileHorizontalement(page) {
  return page.evaluate(() => {
    const d = document.documentElement;
    return Math.max(d.scrollWidth, document.body.scrollWidth) - d.clientWidth > 1;
  });
}

/** Largeurs de référence du brief. */
export const LARGEURS = Object.freeze([
  { nom: '320 px (mobile étroit)', width: 320, height: 800 },
  { nom: '768 px (tablette)', width: 768, height: 1024 },
  { nom: '1024 px (petit écran)', width: 1024, height: 768 },
  { nom: '1600 px (grand écran)', width: 1600, height: 900 },
]);
