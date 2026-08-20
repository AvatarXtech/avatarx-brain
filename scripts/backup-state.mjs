import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const sources = [
  ['agents', 'AGENT_REGISTRY_FILE', '../avatarx-agents/data/registry.json'],
  ['analytics', 'ANALYTICS_DATA_PATH', '../avatarx-analytics/.data/events.jsonl'],
  ['knowledge', 'KNOWLEDGE_STORE_PATH', '../avatarx-knowledge/data/documents.json'],
  ['memory', 'MEMORY_FILE', '../avatarx-memory/data/memories.json']
];

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export async function backupState({ env = process.env, output = env.BACKUP_OUTPUT || './backups', now = new Date() } = {}) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const root = resolve(output, `avatarx-state-${stamp}`);
  const temporary = `${root}.partial`;
  await mkdir(temporary, { recursive: true });
  const files = [];
  for (const [service, variable, fallback] of sources) {
    const source = resolve(env[variable] || fallback);
    try {
      const info = await stat(source);
      if (!info.isFile()) continue;
      const data = await readFile(source);
      const target = `${service}-${basename(source)}`;
      await copyFile(source, join(temporary, target));
      files.push({ service, source, file: target, bytes: data.length, sha256: sha256(data) });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const manifest = { version: 1, createdAt: now.toISOString(), files };
  await writeFile(join(temporary, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, root);
  return { root, manifest };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await backupState();
  console.log(JSON.stringify({ backup: result.root, files: result.manifest.files.length }, null, 2));
}
