import { mkdtemp, readlink, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { linkTargetEquals, portableLink } from './fs-links';

describe('portableLink', () => {
  it('links a file and reports the target', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'powermove-links-'));
    try {
      const source = path.join(directory, 'source.txt');
      const target = path.join(directory, 'target.txt');
      await writeFile(source, 'hello', 'utf8');
      await portableLink(source, target);
      expect(await linkTargetEquals(target, source)).toBe(true);
      expect(await linkTargetEquals(target, path.join(directory, 'other.txt'))).toBe(false);
      expect((await stat(target)).isFile()).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('links a directory and reports the target', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'powermove-links-'));
    try {
      const source = path.join(directory, 'source-dir');
      const target = path.join(directory, 'target-dir');
      const { mkdir } = await import('node:fs/promises');
      await mkdir(source, { recursive: true });
      await portableLink(source, target);
      expect(await linkTargetEquals(target, source)).toBe(true);
      expect((await stat(target)).isDirectory()).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('reports false for missing or plain files', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'powermove-links-'));
    try {
      const plain = path.join(directory, 'plain.txt');
      await writeFile(plain, 'x', 'utf8');
      expect(await linkTargetEquals(plain, path.join(directory, 'source.txt'))).toBe(false);
      expect(await linkTargetEquals(path.join(directory, 'missing.txt'), plain)).toBe(false);
      // readlink of a real symlink still resolves on every platform.
      const { symlink } = await import('node:fs/promises');
      const link = path.join(directory, 'link.txt');
      await symlink(plain, link).catch(() => undefined);
      try {
        expect(await readlink(link)).toBe(plain);
      } catch {
        // Windows without privileges cannot create the fixture symlink.
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
