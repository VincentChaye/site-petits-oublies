/**
 * Point d'entrée : charge .env, valide la configuration, monte les routes,
 * démarre l'automatisation sociale (simulation) puis écoute sur PORT.
 */
// .env chargé AVANT toute lecture de configuration ; son absence est tolérée.
try {
  process.loadEnvFile();
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}

const { loadSecurityConfig } = await import('../security/config.js');

let config;
try {
  config = loadSecurityConfig(process.env);
} catch (e) {
  console.error(`Configuration invalide : ${e.message}`);
  console.error('Créez votre fichier de configuration : cp .env.example .env');
  console.error('puis remplacez INTERNAL_SECRET par un secret unique (ex. : openssl rand -hex 32).');
  process.exit(1);
}

const { createApp } = await import('./app.js');
const { chargerContenu } = await import('./content.js');
const { createStore } = await import('./store.js');
const { createSoumissions } = await import('./soumissions.js');
const { createCompteurVues } = await import('./vues.js');
const { createSocialRuntime } = await import('./social.js');
const { createPublicRouter } = await import('./routes/public.js');
const { createInterneRouter } = await import('./routes/interne.js');

const port = Number.parseInt(process.env.PORT ?? '', 10) || 3000;
const baseUrl = (process.env.BASE_URL || `http://localhost:${port}`).replace(/\/$/, '');
const seuil = Math.max(1, Number.parseInt(process.env.ATTENTION_THRESHOLD ?? '', 10) || 5);

let contenu;
try {
  contenu = chargerContenu();
} catch (e) {
  console.error(`Contenu invalide : ${e.message}`);
  process.exit(1);
}

const store = createStore();
const soumissions = createSoumissions({ store });
const vues = createCompteurVues({ store });

// Purge des soumissions de plus de 12 mois, puis chargement des compteurs.
await soumissions.purger();
await vues.charger();

let social;
try {
  social = createSocialRuntime({
    env: process.env,
    dataDir: store.dir,
    getAnimaux: () => contenu.animaux,
    getVues: () => vues.tous(),
    getSeuil: () => seuil,
  });
} catch (e) {
  console.error(`Automatisation sociale indisponible : ${e.message}`);
  process.exit(1);
}

const app = createApp({
  isProduction: config.isProduction,
  mount(app) {
    app.use('/interne', createInterneRouter({
      contenu, soumissions, vues, social,
      secret: config.internalSecret,
      seuil,
      isProduction: config.isProduction,
    }));
    app.use(createPublicRouter({
      contenu, soumissions, vues, baseUrl,
      secret: config.internalSecret,
    }));
  },
});

social.start();

const serveur = app.listen(port, () => {
  console.log(`Serveur démarré : ${baseUrl.replace(/:\d+$/, `:${port}`)}`);
  console.log(`Espace interne : ${baseUrl}/interne/connexion (secret : INTERNAL_SECRET)`);
  console.log('Publications sociales : simulation uniquement, rien n’est publié réellement.');
});

let arretEnCours = false;
async function arreter(signal) {
  if (arretEnCours) return;
  arretEnCours = true;
  console.log(`Arrêt demandé (${signal}) : fermeture propre.`);
  social.stop();
  await vues.stop();
  serveur.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => { arreter('SIGTERM'); });
process.on('SIGINT', () => { arreter('SIGINT'); });
