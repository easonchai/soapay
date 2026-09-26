// Encrypted backup of the company vault (D-62): wallet-signature lock, sync, restore on an empty browser.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createConfig, http, WagmiProvider } from "wagmi";
import { getAddress, verifyMessage, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { backupMessage, type BackupClient, type StoredBackup } from "@soapay/sdk";
import { DEMO_SESSION_KEY, resolveConfig, setDemoFlag } from "../src/config.js";
import { StoreProvider, useStore } from "../src/hooks/store.js";
import { backupNow, readSync } from "../src/lib/backup.js";
import { createServices } from "../src/lib/services.js";
import { memoryKV, Vault, type KV, type WalletSigner } from "../src/lib/vault.js";
import { createWagmiConfig } from "../src/lib/wagmi.js";
import type { Employee } from "../src/lib/roster.js";

afterEach(() => {
  cleanup();
  sessionStorage.removeItem(DEMO_SESSION_KEY);
  vi.restoreAllMocks();
});

const account = privateKeyToAccount("0x9999999999999999999999999999999999999999999999999999999999999999");
const VAULT_MSG = /^Soapay company vault/;

/** An EOA (or 7702 account): signs every message deterministically (RFC 6979). */
function eoaSigner(): WalletSigner & { signMessage: ReturnType<typeof vi.fn> } {
  return { address: account.address, signMessage: vi.fn((message: string) => account.signMessage({ message })) };
}

/** A passkey smart wallet: valid backup signatures (ERC-1271), but a different vault signature each time. */
function passkeySigner(): WalletSigner & { signMessage: ReturnType<typeof vi.fn> } {
  return {
    address: account.address,
    signMessage: vi.fn(async (message: string) =>
      VAULT_MSG.test(message) ? (`0x${Buffer.from(crypto.getRandomValues(new Uint8Array(65))).toString("hex")}` as Hex) : account.signMessage({ message }),
    ),
  };
}

/** The API's contract, in memory: EIP-191 signature by the address, strictly increasing versions. */
function fakeApi() {
  const rows = new Map<Address, StoredBackup>();
  const client: BackupClient & { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> } = {
    get: vi.fn(async (a: Address) => rows.get(getAddress(a)) ?? null),
    put: vi.fn(async ({ address, version, ciphertext, signature }) => {
      const addr = getAddress(address);
      if (!(await verifyMessage({ address: addr, message: backupMessage({ address: addr, version, ciphertext }), signature }))) {
        return { ok: false as const, code: "bad_signature", message: "bad signature" };
      }
      const cur = rows.get(addr);
      if (cur && version <= cur.version) return { ok: false as const, code: "stale_version" as const, currentVersion: cur.version };
      rows.set(addr, { address: addr, version, ciphertext, updatedAt: 1_800_000_000 });
      return { ok: true as const, address: addr, version };
    }),
  };
  return { client, rows };
}

function employee(n: number): Employee {
  return { id: `e${n}`, ensName: `emp${n}.soapay.eth`, amount: BigInt(n) * 1_000_000n } as unknown as Employee;
}

function mount(opts: { kv: KV; client: BackupClient | null; signer: WalletSigner | null }) {
  const app = { ...resolveConfig(), apiUrl: "http://api.test", demo: false, mockEns: false };
  const services = createServices(app);
  // No connectors: the signer is injected, and nothing here should reach the network.
  const wagmi = createConfig({ chains: [app.chain], connectors: [], transports: { [app.chain.id]: http("http://127.0.0.1:1") } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <WagmiProvider config={wagmi}>
      <StoreProvider app={app} services={services} kv={opts.kv} backupClient={opts.client} signer={opts.signer}>
        {children}
      </StoreProvider>
    </WagmiProvider>
  );
  return renderHook(() => useStore(), { wrapper });
}

describe("company vault backup (store)", () => {
  it("deterministic wallet: wallet lock by default, auto backup after enrolment, restore in an empty browser", async () => {
    const api = fakeApi();
    const signer = eoaSigner();
    const first = mount({ kv: memoryKV(), client: api.client, signer });
    await waitFor(() => expect(first.result.current.phase).toBe("new"));
    expect(first.result.current.walletLock).toBe("available");
    expect(api.client.get).toHaveBeenCalledWith(account.address);

    await act(() => first.result.current.createVault("wallet"));
    await waitFor(() => expect(first.result.current.phase).toBe("ready"));
    expect(first.result.current.vaultMode).toBe("wallet");
    // Signed twice to detect determinism; the key comes from that signature (no third prompt).
    expect(signer.signMessage).toHaveBeenCalledTimes(2);

    // Enrolling recipients is an important moment: one debounced backup, one prompt.
    await act(() => first.result.current.updateEmployees(() => [employee(1)]));
    await act(() => first.result.current.updateEmployees((l) => [...l, employee(2)]));
    expect(first.result.current.backup.sync.dirty).toBe(true);
    await waitFor(() => expect(api.rows.get(account.address)?.version).toBe(1), { timeout: 4000 });
    expect(api.client.put).toHaveBeenCalledTimes(1);
    expect(signer.signMessage).toHaveBeenCalledTimes(3);
    await waitFor(() => expect(first.result.current.backup.sync).toMatchObject({ version: 1, dirty: false, owner: account.address }));

    // "Back up now": the version increments.
    await act(async () => {
      expect(await first.result.current.backupNow()).toMatchObject({ status: "saved", version: 2 });
    });
    expect(first.result.current.backup.sync.version).toBe(2);
    first.unmount();

    // A new browser (or cleared site data): same wallet, empty storage.
    const kv2 = memoryKV();
    const second = mount({ kv: kv2, client: api.client, signer });
    await waitFor(() => expect(second.result.current.phase).toBe("restore"));
    expect(second.result.current.restoreOffer).toMatchObject({ mode: "wallet", version: 2, address: account.address });
    await act(() => second.result.current.restore());
    await waitFor(() => expect(second.result.current.phase).toBe("ready"));
    expect(second.result.current.employees.map((e) => e.ensName)).toEqual(["emp1.soapay.eth", "emp2.soapay.eth"]);
    expect(second.result.current.employees[1]!.amount).toBe(2_000_000n);
    expect(await readSync(kv2)).toMatchObject({ version: 2, owner: account.address, dirty: false });
    // The restored vault stays locked by the wallet and keeps syncing from where it left off.
    expect((await Vault.status(kv2)).exists && (await Vault.status(kv2) as { mode: string }).mode).toBe("wallet");
    await act(async () => {
      expect(await second.result.current.backupNow()).toMatchObject({ status: "saved", version: 3 });
    });
  });

  it("non-deterministic wallet: refuses the wallet lock, falls back to a passphrase that still syncs", async () => {
    const api = fakeApi();
    const signer = passkeySigner();
    const first = mount({ kv: memoryKV(), client: api.client, signer });
    await waitFor(() => expect(first.result.current.phase).toBe("new"));
    await act(async () => {
      await expect(first.result.current.createVault("wallet")).rejects.toMatchObject({ code: "NotDeterministic" });
    });
    expect(first.result.current.walletLock).toBe("unavailable");
    expect(first.result.current.phase).toBe("new");

    await act(() => first.result.current.createVault("passphrase", "correct horse battery"));
    await waitFor(() => expect(first.result.current.phase).toBe("ready"));
    await act(() => first.result.current.updateInvites(() => [{ id: "i1" } as never]));
    await act(async () => {
      expect(await first.result.current.backupNow()).toMatchObject({ status: "saved", version: 1 });
    });
    first.unmount();

    const second = mount({ kv: memoryKV(), client: api.client, signer });
    await waitFor(() => expect(second.result.current.phase).toBe("restore"));
    expect(second.result.current.restoreOffer?.mode).toBe("passphrase");
    await act(async () => {
      await expect(second.result.current.restore("wrong passphrase!")).rejects.toMatchObject({ code: "WrongPassphrase" });
    });
    await act(() => second.result.current.restore("correct horse battery"));
    await waitFor(() => expect(second.result.current.phase).toBe("ready"));
    expect(second.result.current.invites).toEqual([{ id: "i1" }]);
  }, 20_000);

  it("Start fresh: the new vault's first backup replaces the old one", async () => {
    const api = fakeApi();
    const signer = eoaSigner();
    const v = await Vault.create(memoryKV(), "passphrase", "an old passphrase!", { iterations: 1000 });
    const old = await backupNow({ vault: v, kv: memoryKV(), client: api.client, signer });
    expect(old).toMatchObject({ status: "saved", version: 1 });

    const h = mount({ kv: memoryKV(), client: api.client, signer });
    await waitFor(() => expect(h.result.current.phase).toBe("restore"));
    act(() => h.result.current.startFresh());
    await act(() => h.result.current.createVault("wallet"));
    await waitFor(() => expect(h.result.current.phase).toBe("ready"));
    await act(async () => {
      expect(await h.result.current.backupNow()).toMatchObject({ status: "saved", version: 2 });
    });
  });
});

describe("backupNow (lib)", () => {
  it("increments versions, never overwrites a newer backup silently, and handles a declined prompt", async () => {
    const api = fakeApi();
    const signer = eoaSigner();
    const kv = memoryKV();
    const v = await Vault.create(kv, "passphrase", "correct horse battery", { iterations: 1000 });
    expect(await backupNow({ vault: v, kv, client: api.client, signer })).toMatchObject({ status: "saved", version: 1 });
    expect(await backupNow({ vault: v, kv, client: api.client, signer })).toMatchObject({ status: "saved", version: 2 });

    // Another browser pushed version 5: no prompt, a conflict; replacing it is explicit.
    api.rows.set(account.address, { ...api.rows.get(account.address)!, version: 5 });
    signer.signMessage.mockClear();
    expect(await backupNow({ vault: v, kv, client: api.client, signer })).toEqual({ status: "conflict", remoteVersion: 5 });
    expect(signer.signMessage).not.toHaveBeenCalled();
    expect(await backupNow({ vault: v, kv, client: api.client, signer, replace: true })).toMatchObject({ status: "saved", version: 6 });

    const declining: WalletSigner = { address: account.address, signMessage: async () => Promise.reject({ code: 4001, message: "User rejected the request." }) };
    expect(await backupNow({ vault: v, kv, client: api.client, signer: declining })).toEqual({ status: "declined" });
    expect((await readSync(kv)).version).toBe(6);

    // Device-key vaults can't be backed up; another wallet can't write this vault's slot.
    const dkv = memoryKV();
    expect(await backupNow({ vault: await Vault.create(dkv, "device"), kv: dkv, client: api.client, signer })).toEqual({ status: "unsupported" });
    const other = privateKeyToAccount("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(
      await backupNow({ vault: v, kv, client: api.client, signer: { address: other.address, signMessage: (m) => other.signMessage({ message: m }) } }),
    ).toEqual({ status: "wrong-wallet", owner: account.address });
  });
});

describe("demo mode", () => {
  it("never calls the backup API or asks the wallet to sign", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    setDemoFlag(true);
    const app = resolveConfig();
    expect(app.demo).toBe(true);
    const wagmi = createWagmiConfig(app);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <WagmiProvider config={wagmi}>
        <StoreProvider app={app} services={createServices(app)} kv={memoryKV()}>
          {children}
        </StoreProvider>
      </WagmiProvider>
    );
    const h = renderHook(() => useStore(), { wrapper });
    await waitFor(() => expect(h.result.current.phase).toBe("new"));
    expect(h.result.current.walletLock).toBe("hidden");
    expect(h.result.current.backup.enabled).toBe(false);
    await act(() => h.result.current.createVault("device"));
    await waitFor(() => expect(h.result.current.phase).toBe("ready"));
    await act(() => h.result.current.updateEmployees((l) => l.slice(1)));
    await new Promise((r) => setTimeout(r, 2_300)); // past the backup debounce
    expect(fetchSpy.mock.calls.filter(([u]) => String(u).includes("/backups"))).toEqual([]);
    expect(h.result.current.backup.last).toBeNull();
  });
});
