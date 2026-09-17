import { CliError } from "./client.mjs";
export async function credentialStore(origin) {
  let entry;
  try {
    const { Entry } = await import("@napi-rs/keyring");
    entry = new Entry("Rebody CLI", origin);
  } catch { throw new CliError("credential_store_unavailable", "Unlock your operating system credential store, or provide REBODY_TOKEN through a secret manager."); }
  return {
    read() {
      try { const value = entry.getPassword(); return value ? JSON.parse(value) : {}; }
      catch { throw new CliError("credential_store_unavailable", "Could not read the Rebody credential. Unlock your credential store and try again."); }
    },
    write(value) {
      try { entry.setPassword(JSON.stringify(value)); }
      catch { throw new CliError("credential_store_unavailable", "Could not save the Rebody credential in your operating system credential store."); }
    },
    clear() { try { entry.deletePassword(); } catch { throw new CliError("credential_store_unavailable", "Could not remove the local Rebody credential."); } },
  };
}
