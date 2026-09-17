import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkedOrigin, checkedStorageUrl, createApi, fileManifest, uploadFile } from "../lib/client.mjs";

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "rebody-cli-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "labs.pdf");
  await writeFile(file, "synthetic lab data");
  return file;
}
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
test("credentials can only be sent to Rebody or explicit local development", () => {
  assert.equal(checkedOrigin(), "https://rebodyhealth.com");
  assert.equal(checkedOrigin("http://localhost:3017"), "http://localhost:3017");
  for (const url of ["https://evil.test", "https://rebodyhealth.com.evil.test", "https://user:pass@rebodyhealth.com", "http://rebodyhealth.com", "https://rebodyhealth.com/path"]) assert.throws(() => checkedOrigin(url));
  assert.throws(() => checkedStorageUrl("https://example.com/upload", "https://rebodyhealth.com"));
  assert.throws(() => checkedStorageUrl("http://localhost/upload", "https://rebodyhealth.com"));
  assert.throws(() => checkedStorageUrl("ftp://localhost/upload", "http://localhost:3000"));
  assert.throws(() => checkedStorageUrl("https://project.supabase.co/upload#secret", "https://rebodyhealth.com"));
});
test("idempotency key is stable for a file, changes with content or category", async (t) => {
  const file = await fixture(t);
  const first = (await fileManifest(file, "bloodwork")).manifest;
  assert.deepEqual((await fileManifest(file, "bloodwork")).manifest, first);
  assert.notEqual((await fileManifest(file, "dna")).manifest.requestKey, first.requestKey);
  await writeFile(file, "updated synthetic lab data");
  assert.notEqual((await fileManifest(file, "bloodwork")).manifest.requestKey, first.requestKey);
  await assert.rejects(fileManifest(file, "other"), { code: "invalid_kind" });
});
test("auth errors are structured and bearer requests never follow redirects", async () => {
  const api = createApi("https://rebodyhealth.com", "secret", async (url, options) => {
    assert.equal(options.headers.Authorization, "Bearer secret");
    assert.equal(options.redirect, "error");
    return reply({ error: "unauthorized", message: "Sign in again." }, 401);
  });
  await assert.rejects(api("auth/status"), { code: "unauthorized", status: 401 });
});
test("an uncertain token exchange is never silently replayed", async () => {
  let count = 0;
  const api = createApi("https://rebodyhealth.com", undefined, async () => { count++; throw new Error("lost response"); });
  await assert.rejects(api("auth/token", { device_code: "private" }), { code: "network_error" });
  assert.equal(count, 1);
});
test("streams original bytes to storage without bearer credentials, then completes", async (t) => {
  const file = await fixture(t);
  let stored = false;
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push(url);
    if (url.endsWith("/uploads")) return reply({ uploadId: "upload-1", upload: { url: "https://project.supabase.co/storage/upload", headers: { apikey: "public", Authorization: "must-not-forward" } } });
    if (url.endsWith("/complete")) return stored ? reply({ status: "uploaded", href: "/account/records" }) : reply({ error: "upload_incomplete", message: "pending" }, 409);
    assert.equal(url, "https://project.supabase.co/storage/upload");
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers.apikey, "public");
    assert.equal(options.redirect, "error");
    const chunks = [];
    for await (const bytes of options.body) chunks.push(bytes);
    assert.equal(Buffer.concat(chunks).toString(), "synthetic lab data");
    stored = true; return reply({});
  };
  const receipt = await uploadFile({ file, kind: "bloodwork", origin: "https://rebodyhealth.com", token: "private", fetcher });
  assert.equal(receipt.status, "uploaded");
  assert.equal(calls.filter((url) => url.includes("supabase.co")).length, 1);
});
test("a retry after a completed transfer does not upload bytes again", async (t) => {
  const file = await fixture(t);
  const fetcher = async (url) => {
    if (url.endsWith("/uploads")) return reply({ uploadId: "upload-1" });
    assert.ok(url.endsWith("/complete"));
    return reply({ status: "uploaded", href: "/account/records" });
  };
  assert.equal((await uploadFile({ file, kind: "bloodwork", origin: "https://rebodyhealth.com", token: "private", fetcher })).status, "uploaded");
});
test("a lost storage response still completes a successful upload", async (t) => {
  const file = await fixture(t);
  let stored = false;
  const fetcher = async (url, options) => {
    if (url.endsWith("/uploads")) return reply({ uploadId: "upload-1", upload: { url: "https://project.supabase.co/storage/upload", headers: {} } });
    if (url.endsWith("/complete")) return stored ? reply({ status: "uploaded" }) : reply({ error: "upload_incomplete" }, 409);
    for await (const bytes of options.body) assert.ok(bytes.length);
    stored = true; throw new Error("response lost");
  };
  assert.equal((await uploadFile({ file, kind: "bloodwork", origin: "https://rebodyhealth.com", token: "private", fetcher })).status, "uploaded");
});
