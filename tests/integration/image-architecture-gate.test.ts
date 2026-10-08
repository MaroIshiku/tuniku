import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("binds both runtime results and scan outputs to immutable child digests and refuses wrong architecture or source", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tuniku-architecture-gate-")), bin = path.join(root, "bin"); fs.mkdirSync(bin);
  const revision = "1".repeat(40), amd = `sha256:${"a".repeat(64)}`, arm = `sha256:${"b".repeat(64)}`;
  fs.writeFileSync(path.join(bin, "docker"), `#!${process.execPath}\nconst fs=require('node:fs'),args=process.argv.slice(2),mode=process.env.PROBE_MODE;
    if(args.includes('--raw')){console.log(JSON.stringify({manifests:[{platform:{os:'linux',architecture:'amd64'},digest:'${amd}'},{platform:{os:'linux',architecture:'arm64'},digest:'${arm}'}]}));process.exit(0);}
    if(args[0]==='pull'){fs.appendFileSync('pulls.jsonl',JSON.stringify(args)+'\\n');process.exit(0);}
    const architecture=args[2].endsWith('${arm}')?'arm64':'amd64';console.log(JSON.stringify([{Id:architecture==='amd64'?'${amd}':'${arm}',Architecture:mode==='wrong-architecture'?'amd64':architecture,Config:{Labels:{'org.opencontainers.image.revision':mode==='wrong-source'?'2'.repeat(40):'${revision}'}}}]));\n`, { mode: 0o700 });
  try {
    for (const mode of ["valid", "wrong-architecture", "wrong-source"]) {
      const working = path.join(root, mode); fs.mkdirSync(path.join(working, "scripts"), { recursive: true });
      fs.writeFileSync(path.join(working, "scripts/verify-container-lifecycle.ts"), `console.log(JSON.stringify({result:'PASS',imageId:process.env.TUNIKU_TEST_IMAGE,architecture:process.env.TUNIKU_TEST_IMAGE==='${amd}'?'amd64':'arm64'}));`);
      const output = path.join(working, "outputs");
      const result = spawnSync(process.execPath, [path.resolve("scripts/verify-image-architectures.ts")], { cwd: working, encoding: "utf8", timeout: 10_000, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, IMAGE: "ghcr.io/synthetic/tuniku", DIGEST: `sha256:${"c".repeat(64)}`, GITHUB_SHA: revision, GITHUB_OUTPUT: output, PROBE_MODE: mode } });
      if (mode === "valid") {
        expect(result.status, result.stderr).toBe(0);
        expect(fs.readFileSync(output, "utf8")).toBe(`amd64_digest=${amd}\narm64_digest=${arm}\n`);
        const report = JSON.parse(fs.readFileSync(path.join(working, "architecture-runtime-report.json"), "utf8")); expect(report.results).toHaveLength(2);
        expect(report.results.map((row: { manifestDigest: string }) => row.manifestDigest)).toEqual([amd, arm]);
        const pulls = fs.readFileSync(path.join(working, "pulls.jsonl"), "utf8"); expect(pulls).toContain(`ghcr.io/synthetic/tuniku@${amd}`); expect(pulls).toContain(`ghcr.io/synthetic/tuniku@${arm}`); expect(pulls).not.toContain("latest");
      } else { expect(result.status).not.toBe(0); expect(fs.existsSync(output)).toBe(false); }
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
