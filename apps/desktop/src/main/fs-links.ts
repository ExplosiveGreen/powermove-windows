import { copyFile, link, lstat, readlink, symlink } from 'node:fs/promises';

/* Creating a symlink on Windows needs elevation or Developer Mode, which a
   normal install cannot assume. Directories become junctions and files become
   hard links (same volume) or plain copies — all privilege-free. Anywhere
   else the historical symlink behavior is kept exactly. */

/** Whether `target` is a link (symlink or junction) pointing at `source`. */
export async function linkTargetEquals(target: string, source: string): Promise<boolean> {
  try {
    return await readlink(target) === source;
  } catch {
    return false;
  }
}

/** Link `target` at `source` without assuming symlink privileges on Windows. */
export async function portableLink(source: string, target: string): Promise<void> {
  if (process.platform !== 'win32') {
    await symlink(source, target);
    return;
  }
  if ((await lstat(source)).isDirectory()) {
    await symlink(source, target, 'junction');
    return;
  }
  try {
    await link(source, target);
  } catch (error) {
    // Cross-volume: a hard link cannot span drives, so copy instead.
    if ((error as NodeJS.ErrnoException).code === 'EXDEV') {
      await copyFile(source, target);
      return;
    }
    throw error;
  }
}
