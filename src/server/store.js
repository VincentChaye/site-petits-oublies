/**
 * Stockage JSON : écriture atomique (fichier temporaire + rename), écritures
 * sérialisées par fichier (un seul processus). Un JSON corrompu lève une erreur
 * explicite et n'est jamais écrasé.
 * @module server/store
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

/** Erreur levée quand un fichier de données n'est pas un JSON valide. */
export class CorruptedStoreError extends Error {
  constructor(file, cause) {
    super(`Fichier de données corrompu (JSON invalide) : ${file}. Corrigez-le ou supprimez-le manuellement.`, { cause });
    this.name = 'CorruptedStoreError';
    this.file = file;
  }
}

/**
 * @param {{dir?: string}} [options] dir : dossier des données (défaut DATA_DIR ou « data »).
 */
export function createStore({ dir = process.env.DATA_DIR || 'data' } = {}) {
  const root = path.resolve(dir);
  const queues = new Map();

  function resolve(name) {
    if (typeof name !== 'string' || !/^[A-Za-z0-9_-]+(\.json)?$/.test(name)) {
      throw new Error(`Nom de collection invalide : ${String(name)}`);
    }
    return path.join(root, name.endsWith('.json') ? name : `${name}.json`);
  }

  async function readFile(file, fallback) {
    let txt;
    try {
      txt = await fs.readFile(file, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') return structuredClone(fallback);
      throw e;
    }
    try {
      return JSON.parse(txt);
    } catch (e) {
      throw new CorruptedStoreError(file, e);
    }
  }

  async function writeAtomic(file, data) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
      await fs.rename(tmp, file);
    } catch (e) {
      await fs.rm(tmp, { force: true });
      throw e;
    }
  }

  /** Exécute fn après les opérations précédentes du même fichier. */
  function enqueue(file, fn) {
    const prev = queues.get(file) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => {});
    queues.set(file, tail);
    tail.then(() => { if (queues.get(file) === tail) queues.delete(file); });
    return run;
  }

  return {
    dir: root,
    /** Lit une collection ; `fallback` si le fichier n'existe pas. */
    read(name, fallback = null) {
      const file = resolve(name);
      return enqueue(file, () => readFile(file, fallback));
    },
    /** Remplace une collection (atomique, sérialisé). */
    write(name, data) {
      const file = resolve(name);
      return enqueue(file, () => writeAtomic(file, data));
    },
    /** Lecture-modification-écriture sérialisée ; fn(valeur) renvoie la nouvelle valeur. */
    update(name, fn, fallback = null) {
      const file = resolve(name);
      return enqueue(file, async () => {
        const next = await fn(await readFile(file, fallback));
        await writeAtomic(file, next);
        return next;
      });
    },
  };
}
