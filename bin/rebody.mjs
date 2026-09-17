#!/usr/bin/env node
import { hostname } from "node:os";
import { createApi, checkedOrigin, CliError, uploadFile } from "../lib/client.mjs";
import { credentialStore } from "../lib/credentials.mjs";

const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const output = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const help = `Rebody CLI 0.1.0 (Node.js 22+)\n\nrebody auth login --json     Start a connection; returns an approval URL and code\nrebody auth wait --json      Wait up to 50 seconds for approval; repeat while pending\nrebody auth status --json    Check your saved connection\nrebody auth logout --json    Revoke the connection and remove local credentials\nrebody records upload FILE --kind dna|bloodwork --json [--new-upload]\n\nAll results are JSON. File bytes go directly to private storage.\nDNA imports save the original file; they do not order lab analysis.\nUse --origin http://localhost:3000 for local development.\nREBODY_TOKEN may supply a credential from a secret manager.\n`;
async function main() {
  if (!args.length || args.includes("--help")) { process.stdout.write(help); return; }
  if (args.includes("--version")) { process.stdout.write("0.1.0\n"); return; }
  const origin = checkedOrigin(option("--origin") || process.env.REBODY_ORIGIN);
  const [group, command] = args;
  const supplied = process.env.REBODY_TOKEN;
  const store = supplied ? null : await credentialStore(origin);
  let credentials = store?.read() || {};
  const api = createApi(origin, supplied || credentials.token);
  if (group === "auth" && command === "login") {
    if (!store) throw new CliError("token_supplied", "Remove REBODY_TOKEN before starting an interactive connection.");
    if (credentials.token) {
      try {
        await api("auth/status");
        throw new CliError("already_connected", "This CLI is already connected. Use it, or run rebody auth logout before connecting another account.");
      } catch (error) {
        if (error.status !== 401) throw error;
        credentials = {};
        store.write(credentials);
      }
    }
    const result = await createApi(origin)("auth/device", { client_name: `Rebody CLI on ${hostname()}` });
    store.write({ ...credentials, pending: { deviceCode: result.device_code, expiresAt: Date.now() + result.expires_in * 1000, interval: result.interval } });
    // The poll secret stays in secure storage. Only the approval code and URL enter chat.
    output({ status: "approval_required", verificationUrl: result.verification_uri_complete, userCode: result.user_code,
      expiresIn: result.expires_in, next: "Open the link yourself, check the code, and approve. Then run rebody auth wait --json." });
    return;
  }
  if (group === "auth" && command === "wait") {
    if (!store || !credentials.pending) throw new CliError("no_pending_connection", "Run rebody auth login first.");
    const pending = credentials.pending;
    if (pending.expiresAt <= Date.now()) {
      delete credentials.pending;
      store.write(credentials);
      throw new CliError("expired_token", "The approval code expired. Run rebody auth login again.");
    }
    const stopAt = Math.min(Date.now() + 50_000, pending.expiresAt);
    while (Date.now() < stopAt) {
      await new Promise((resolve) => setTimeout(resolve, Math.max(5, pending.interval) * 1000));
      try {
        const result = await createApi(origin)("auth/token", { device_code: pending.deviceCode });
        credentials = { token: result.access_token, connectionId: result.connection_id, expiresAt: Date.now() + result.expires_in * 1000 };
        store.write(credentials);
        output({ connected: true, expiresAt: new Date(credentials.expiresAt).toISOString(), scope: result.scope }); return;
      } catch (error) {
        if (!["authorization_pending", "rate_limited"].includes(error.code) && error.status !== 429) {
          // Keep any previous valid connection, but discard a refused/consumed device code.
          if (["access_denied", "expired_token"].includes(error.code)) { delete credentials.pending; store.write(credentials); }
          throw error;
        }
      }
    }
    output({ status: "authorization_pending", next: "Complete browser approval, then run rebody auth wait --json again." });
    process.exitCode = 2; return;
  }
  if (!supplied && !credentials.token) throw new CliError("unauthorized", "Run rebody auth login --json first.");
  if (group === "auth" && command === "status") { output(await api("auth/status")); return; }
  if (group === "auth" && command === "logout") {
    try { await api("auth/revoke", {}); } catch (error) { if (error.status !== 401) throw error; }
    store?.clear(); output({ disconnected: true }); return;
  }
  if (group === "records" && command === "upload") {
    const file = args[2];
    if (!file || file.startsWith("--")) throw new CliError("missing_file", "Provide the local file path.");
    let lastPercent = -1;
    const result = await uploadFile({ file, newUpload: args.includes("--new-upload"), kind: option("--kind"), origin, token: supplied || credentials.token,
      progress: (sent, total) => { const percent = Math.floor(sent / total * 100); if (process.stderr.isTTY && percent >= lastPercent + 5) { process.stderr.write(`\rUploading: ${percent}%`); lastPercent = percent; } } });
    if (process.stderr.isTTY) process.stderr.write("\n");
    output({ ...result, url: new URL(result.href, origin).href }); return;
  }
  throw new CliError("unknown_command", "Run rebody --help to see available commands.");
}
main().catch((error) => {
  output({ error: error instanceof CliError ? error.code : "local_error", message: error instanceof CliError ? error.message : "The command could not finish. Check the file path and local permissions, then try again." });
  process.exitCode = 1;
});
