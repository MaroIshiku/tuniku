import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("promotes only the checked digest through the real helper and fails closed on ambiguous registry or ancestry data", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tuniku-promotion-")), bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  const candidate = "2".repeat(40), previous = "1".repeat(40), digest = `sha256:${"a".repeat(64)}`, oldDigest = `sha256:${"b".repeat(64)}`;
  const image = "ghcr.io/synthetic/tuniku";
  fs.writeFileSync(path.join(bin, "docker"), `#!${process.execPath}\nconst fs=require('node:fs'),args=process.argv.slice(2),mode=process.env.PROBE_MODE;
    if(args.includes('create')){fs.appendFileSync('writes.jsonl',JSON.stringify(args)+'\\n');process.exit(0);}
    const ref=args[3];
    if(/:v?1\\.2\\.3$/.test(ref)){if(mode==='existing-version'){console.log('exists');process.exit(0);}console.error('manifest unknown');process.exit(1);}
    if(ref.endsWith(':latest')){if(mode==='registry-failure'){console.error('authentication failed');process.exit(1);}console.log('Digest: ${oldDigest}');process.exit(0);}
    let revision=ref.includes('${digest}')?'${candidate}':'${previous}';
    if(mode==='candidate-mismatch'&&ref.includes('${digest}'))revision='3'.repeat(40);
    const config={config:{Labels:{'org.opencontainers.image.revision':revision}}};console.log(JSON.stringify({'linux/amd64':config,'linux/arm64':config}));\n`, { mode: 0o700 });
  fs.writeFileSync(path.join(bin, "git"), `#!${process.execPath}\nconst mode=process.env.PROBE_MODE,args=process.argv.slice(2);if(mode==='missing-history')process.exit(128);if(mode==='unrelated')process.exit(1);const forward=args[2]==='${previous}';process.exit((mode==='older-candidate'?!forward:forward)?0:1);\n`, { mode: 0o700 });
  try {
    for (const mode of ["descendant", "older-candidate", "unrelated", "missing-history", "registry-failure", "candidate-mismatch", "existing-version"]) {
      const working = path.join(root, mode); fs.mkdirSync(working);
      const result = spawnSync(process.execPath, [path.resolve("scripts/promote-image.ts")], { cwd: working, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, IMAGE: image, DIGEST: digest, GITHUB_SHA: candidate, VERSION: "1.2.3", PROBE_MODE: mode }, timeout: 10_000 });
      const file = path.join(working, "writes.jsonl"), writes = fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").map(line => JSON.parse(line) as string[]) : [];
      if (mode === "descendant" || mode === "older-candidate") {
        expect(result.status, result.stderr).toBe(0); expect(writes).toHaveLength(mode === "descendant" ? 2 : 1);
        expect(writes.every(args => args.at(-1) === `${image}@${digest}`)).toBe(true);
        expect(writes.some(args => args.includes(`${image}:latest`))).toBe(mode === "descendant");
        expect(JSON.parse(fs.readFileSync(path.join(working, "promotion-report.json"), "utf8"))).toMatchObject({ candidateDigest: digest, previousDigest: oldDigest, decision: mode === "descendant" ? "promote" : "keep_newer" });
      } else { expect(result.status).not.toBe(0); expect(writes).toHaveLength(0); }
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
