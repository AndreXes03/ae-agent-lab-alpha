import { mkdir, lstat, realpath, open, rename, unlink, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export async function privateDirectory(dir: string) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const st = await lstat(dir);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error("Unsafe job directory");
  // Canonical parents permit macOS /var -> /private/var without following a job symlink.
  return path.join(await realpath(path.dirname(dir)), path.basename(dir));
}
export async function atomicJson(file: string, data: unknown) {
  const temp = path.join(path.dirname(file), "." + randomUUID() + ".tmp");
  const h = await open(temp, "wx", 0o600);
  try {
    await h.writeFile(JSON.stringify(data));
    await h.sync();
  } finally {
    await h.close();
  }
  try {
    await rename(temp, file);
  } finally {
    await unlink(temp).catch(() => undefined);
  }
}
export async function readJson<T>(file: string): Promise<T> {
  const st = await lstat(file);
  if (!st.isFile() || st.isSymbolicLink() || st.size > 16 * 1024 * 1024)
    throw new Error("Unsafe or oversized record");
  return JSON.parse(await readFile(file, "utf8")) as T;
}
export async function exclusiveClaim(file: string, value: unknown) {
  try {
    const h = await open(file, "wx", 0o600);
    try {
      await h.writeFile(JSON.stringify(value));
      await h.sync();
    } finally {
      await h.close();
    }
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  }
}
