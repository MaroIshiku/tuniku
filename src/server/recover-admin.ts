import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import { recoverLocalAdmin } from "./recovery/localAdmin.js";

async function hiddenInput(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Recovery requires an interactive terminal; passwords are not accepted in arguments, environment or pipes.");
  process.stdout.write(label);
  readline.emitKeypressEvents(process.stdin);
  const priorRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true); process.stdin.resume();
  let answer = "";
  let cancel: (() => void) | undefined;
  let removeKeypress: (() => void) | undefined;
  try {
    return await new Promise<string>((resolve, reject) => {
      cancel = () => reject(new Error("Recovery cancelled."));
      process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
      const keypress = (text: string | undefined, key: { name?: string; ctrl?: boolean; meta?: boolean }) => {
        if (key.ctrl && key.name === "c") { process.stdin.off("keypress", keypress); reject(new Error("Recovery cancelled.")); }
        else if (key.name === "return" || key.name === "enter") { process.stdin.off("keypress", keypress); resolve(answer); }
        else if (key.name === "backspace") answer = Array.from(answer).slice(0, -1).join("");
        else if (!key.ctrl && !key.meta && text && !Array.from(text).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) answer = (answer + text).slice(0, 4097);
      };
      removeKeypress = () => { process.stdin.off("keypress", keypress); };
      process.stdin.on("keypress", keypress);
    });
  } finally { removeKeypress?.(); if (cancel) { process.off("SIGINT", cancel); process.off("SIGTERM", cancel); } process.stdin.setRawMode(priorRaw); process.stdin.pause(); process.stdout.write("\n"); answer = ""; }
}

export async function runRecovery(args: string[]): Promise<void> {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (["--service-stopped", "--backup-confirmed"].includes(argument)) { if (flags.has(argument)) throw new Error("Duplicate recovery option."); flags.add(argument); }
    else if (["--database", "--username"].includes(argument) && args[index + 1] && !args[index + 1]!.startsWith("--") && !values.has(argument)) values.set(argument, args[++index]!);
    else throw new Error("Use --database PATH --username NAME --service-stopped --backup-confirmed. Never pass a password as an argument.");
  }
  if (!values.has("--database") || !values.has("--username") || !flags.has("--service-stopped") || !flags.has("--backup-confirmed")) throw new Error("Specify the existing database and administrator, stop Tuniku and confirm a matching backup.");
  const password = await hiddenInput("New administrator password (hidden): ");
  const passwordConfirm = await hiddenInput("Repeat password (hidden): ");
  const result = await recoverLocalAdmin({ databasePath: values.get("--database")!, username: values.get("--username")!, password, passwordConfirm, serviceStopped: true, backupConfirmed: true, ...(process.env.ISHIKU_SETUP_SECRET ? { setupSecret: process.env.ISHIKU_SETUP_SECRET } : {}) });
  process.stdout.write(`Administrator password changed; ${result.revokedSessions} session(s) revoked. Restart Tuniku and sign in. VPN data and encryption keys were retained.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void runRecovery(process.argv.slice(2)).catch(() => { process.stderr.write("Local admin recovery was refused or failed. Check the arguments, stopped service, matching backup, private file ownership, database version and password requirements. Existing data and keys must be retained.\n"); process.exitCode = 1; });
}
