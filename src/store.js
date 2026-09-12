import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function readTargetsFile(file) {
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.targets) ? parsed.targets : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function writeTargetsFile(file, targets) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify({ targets }, null, 2)}\n`, 'utf8');
}
