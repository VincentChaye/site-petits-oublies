/**
 * Tests de bout en bout : parcours publics, espace interne et accessibilité (axe-core).
 * Le serveur est démarré par Playwright sur des dossiers jetables (`.tmp-e2e/`),
 * en simulation sociale uniquement : aucun appel réseau sortant.
 */
import { defineConfig, devices } from '@playwright/test';
import {
  BASE_URL, PORT, CONTENT_DIR, DATA_DIR, INTERNAL_SECRET, ATTENTION_THRESHOLD,
} from './tests/e2e/environnement.js';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.spec\.js$/,
  // Les parcours écrivent dans les mêmes fichiers JSON : un seul worker, pas de parallélisme.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    ...devices['Desktop Chrome'],
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    // Le lanceur prépare les dossiers jetables puis démarre le serveur normal.
    command: 'node tests/e2e/serveur-de-test.js',
    url: `${BASE_URL}/`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      NODE_ENV: 'development',
      PORT: String(PORT),
      BASE_URL,
      CONTENT_DIR,
      DATA_DIR,
      INTERNAL_SECRET,
      ATTENTION_THRESHOLD: String(ATTENTION_THRESHOLD),
      // Simulation uniquement : le mode « reel » n'est pas implémenté.
      SOCIAL_MODE: 'simulation',
      SOCIAL_SITE_URL: BASE_URL,
      SOCIAL_FACEBOOK_ENABLED: 'true',
      SOCIAL_INSTAGRAM_ENABLED: 'true',
      SOCIAL_X_ENABLED: 'true',
      SOCIAL_LINKEDIN_ENABLED: 'true',
      SOCIAL_FACEBOOK_API_KEY: 'cle-de-test',
      SOCIAL_INSTAGRAM_API_KEY: 'cle-de-test',
      SOCIAL_X_API_KEY: 'cle-de-test',
      SOCIAL_LINKEDIN_API_KEY: 'cle-de-test',
      SOCIAL_SIMULATE_FAILURE: '',
    },
  },
});
