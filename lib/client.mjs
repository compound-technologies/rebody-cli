import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";

export class CliError extends Error {
  constructor(code, message, status = 0) { super(message); this.code = code; this.status = status; }
}
export function checkedOrigin(value = "https://rebodyhealth.com") {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((!local && url.origin !== "https://rebodyhealth.com") || (local && !["http:", "https:"].includes(url.protocol)) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new CliError("invalid_origin", "Use https://rebodyhealth.com, or a localhost origin for development.");
  }
  return url.origin;
}
export function checkedStorageUrl(value, origin) {
  const url = new URL(value);
  const local = new URL(origin).hostname;
  const localStorage = ["localhost", "127.0.0.1", "[::1]"].includes(local) && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!["http:", "https:"].includes(url.protocol) || url.hash || url.username || url.password || (!localStorage && (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co")))) {
    throw new CliError("invalid_upload_destination", "The API returned an unexpected storage destination.");
  }
  return url.href;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function createApi(origin, token, fetcher = fetch) {
  return async (path, body) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      let response;
      try {
        response = await fetcher(`${origin}/api/agent-import/${path}`, {
          method: body === undefined ? "GET" : "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch {
        // Auth exchange is consumable once. Do not replay after an uncertain response.
        if (path.startsWith("auth/") || attempt === 3) throw new CliError("network_error", "Could not reach Rebody. Try again.");
        await sleep(1000 * (attempt + 1)); continue;
      }
      const result = await response.json().catch(() => ({}));
      if (response.ok) return result;
      if ((response.status === 429 || response.status >= 500) && attempt < 3 && !path.startsWith("auth/")) {
        const delay = Math.min(30, Math.max(1, Number(response.headers.get("retry-after")) || attempt + 1));
        await sleep(delay * 1000); continue;
      }
      throw new CliError(typeof result.error === "string" ? result.error : "request_failed", result.message || "Rebody could not complete this request.", response.status);
    }
  };
}
export async function fileManifest(file, kind) {
  if (!["dna", "bloodwork"].includes(kind)) throw new CliError("invalid_kind", "Use --kind dna or --kind bloodwork.");
  const before = await stat(file);
  if (!before.isFile() || before.size <= 0 || before.size > 5 * 1024 ** 3) throw new CliError("invalid_file", "Choose a nonempty file up to 5 GB.");
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  const sha256 = digest.digest("hex");
  const after = await stat(file);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new CliError("file_changed", "The file changed. Try again after it finishes saving.");
  const fileName = basename(file);
  const key = createHash("sha256").update(JSON.stringify([kind, fileName, before.size, sha256])).digest("hex").slice(0, 32).split("");
  key[12] = "4"; key[16] = "8";
  const hex = key.join("");
  const requestKey = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const ext = fileName.toLowerCase().split(".").pop();
  const mimeType = ({ pdf: "application/pdf", csv: "text/csv", txt: "text/plain", zip: "application/zip", gz: "application/gzip", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" })[ext] || "application/octet-stream";
  return { manifest: { kind, fileName, byteSize: before.size, mimeType, sha256, requestKey }, mtimeMs: before.mtimeMs };
}
export async function uploadFile({ file, kind, origin, token, fetcher = fetch, progress = () => {}, newUpload = false }) {
  const { manifest, mtimeMs } = await fileManifest(file, kind);
  if (newUpload) manifest.requestKey = randomUUID();
  const api = createApi(origin, token, fetcher);
  const reservation = await api("uploads", manifest);
  if (typeof reservation.uploadId !== "string") throw new CliError("invalid_response", "Rebody did not return an upload ID.");
  const path = `uploads/${encodeURIComponent(reservation.uploadId)}`;
  // Retry completion first: a prior PUT may have succeeded despite a lost response.
  try { return await api(`${path}/complete`, {}); }
  catch (error) { if (error.code !== "upload_incomplete") throw error; }
  const url = checkedStorageUrl(reservation.upload?.url, origin);
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await stat(file);
    if (current.size !== manifest.byteSize || current.mtimeMs !== mtimeMs) throw new CliError("file_changed", "The file changed. Start the upload again.");
    let sent = 0;
    const source = createReadStream(file);
    async function* bytes() {
      for await (const chunk of source) { sent += chunk.length; progress(sent, manifest.byteSize); yield chunk; }
    }
    let response;
    try {
      // Never attach the Rebody credential to Storage or follow a redirect with it.
      response = await fetcher(url, {
        method: "PUT", redirect: "error", duplex: "half", body: bytes(), signal: AbortSignal.timeout(2 * 60 * 60 * 1000),
        headers: { "Content-Type": manifest.mimeType, "Content-Length": String(manifest.byteSize), "x-upsert": "false",
          ...(reservation.upload.headers?.apikey ? { apikey: reservation.upload.headers.apikey } : {}) },
      });
    } catch { /* Completion below handles a successful PUT with a lost response. */ }
    finally { source.destroy(); }
    const after = await stat(file);
    if (after.size !== manifest.byteSize || after.mtimeMs !== mtimeMs) throw new CliError("file_changed", "The file changed during upload. Start again.");
    try { return await api(`${path}/complete`, {}); }
    catch (error) {
      if (error.code !== "upload_incomplete") throw error;
      if (response && !response.ok && response.status < 500 && ![409, 429].includes(response.status)) {
        throw new CliError("upload_failed", "Storage rejected this file. Start a new upload.");
      }
      if (attempt === 2) throw new CliError("upload_incomplete", "Upload interrupted. Run the same command again to retry.");
      await sleep(1000 * (attempt + 1));
    }
  }
}
