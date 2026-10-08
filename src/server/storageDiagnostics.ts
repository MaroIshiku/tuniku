import fs from "node:fs";
import path from "node:path";

export function storageDiagnostics(databasePath: string): { privateDirectory: boolean; privateDatabase: boolean; privateSidecars: boolean; ownerMatches: boolean; checked: boolean } {
  try {
    const directory = fs.lstatSync(path.dirname(databasePath));
    const file = fs.lstatSync(databasePath);
    const uid = process.getuid?.();
    let ownerMatches = uid !== undefined && directory.uid === uid && file.uid === uid;
    let privateSidecars = true;
    for (const suffix of ["-wal", "-shm"]) {
      try {
        const sidecar = fs.lstatSync(`${databasePath}${suffix}`);
        privateSidecars &&= sidecar.isFile() && !sidecar.isSymbolicLink() && (sidecar.mode & 0o077) === 0;
        ownerMatches &&= sidecar.uid === uid;
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    return { privateDirectory: directory.isDirectory() && !directory.isSymbolicLink() && (directory.mode & 0o077) === 0,
      privateDatabase: file.isFile() && !file.isSymbolicLink() && (file.mode & 0o077) === 0, privateSidecars, ownerMatches, checked: true };
  } catch { return { privateDirectory: false, privateDatabase: false, privateSidecars: false, ownerMatches: false, checked: false }; }
}
