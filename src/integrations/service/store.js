// Persistance : posts.json (écriture atomique) + journal.jsonl (ajout seul).
// Tout est synchrone et mono-processus : les écritures sont donc sérialisées.
import { mkdirSync, readFileSync, writeFileSync, renameSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function createStore(dataDir) {
  const dir = join(dataDir, 'social');
  const postsFile = join(dir, 'posts.json');
  const journalFile = join(dir, 'journal.jsonl');
  mkdirSync(dir, { recursive: true });

  let posts = [];
  if (existsSync(postsFile)) {
    try {
      const data = JSON.parse(readFileSync(postsFile, 'utf8'));
      posts = Array.isArray(data.posts) ? data.posts : [];
    } catch {
      try { renameSync(postsFile, `${postsFile}.corrompu-${Date.now()}`); } catch { /* ignoré */ }
      posts = [];
    }
  }

  function save() {
    const tmp = `${postsFile}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, posts }, null, 2));
    renameSync(tmp, postsFile);
  }

  function appendJournal(entry) {
    appendFileSync(journalFile, `${JSON.stringify(entry)}\n`);
  }

  function readJournal() {
    if (!existsSync(journalFile)) return [];
    return readFileSync(journalFile, 'utf8').split('\n').filter(Boolean).flatMap((l) => {
      try { return [JSON.parse(l)]; } catch { return []; }
    });
  }

  return { posts, save, appendJournal, readJournal, postsFile, journalFile };
}
