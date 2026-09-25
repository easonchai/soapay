import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { resolveConfig } from "../src/config.js";
import { StoreProvider, useStore } from "../src/hooks/store.js";
import { useInvitePolling, useInvites } from "../src/hooks/useInvites.js";
import { mockInviteApi } from "../src/lib/invites.js";
import { createMockResolver, memoryRotationStore } from "../src/lib/resolver.js";
import type { Services } from "../src/lib/services.js";
import { memoryKV } from "../src/lib/vault.js";
import { createWagmiConfig } from "../src/lib/wagmi.js";

function setup(opts: { claimAfterMs: number; withApi?: boolean }) {
  const app = { ...resolveConfig(), recipientUrl: "https://pay.example" };
  const api = mockInviteApi({ claimAfterMs: opts.claimAfterMs });
  const signer = privateKeyToAccount(generatePrivateKey());
  const services: Services = {
    resolve: createMockResolver(memoryRotationStore(), 0),
    lookupAttestation: async () => ({ state: "unavailable", reason: "test" }),
    invites: opts.withApi === false ? null : api,
    mock: { inviteSigner: signer, rotate: async () => undefined },
  };
  const wagmi = createWagmiConfig(app);
  const kv = memoryKV();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <WagmiProvider config={wagmi}>
      <StoreProvider app={app} services={services} kv={kv}>
        {children}
      </StoreProvider>
    </WagmiProvider>
  );
  const hook = renderHook(
    () => ({ store: useStore(), invites: useInvites(), poll: useInvitePolling({ pollMs: 50 }) }),
    { wrapper },
  );
  return { hook, api, signer };
}

async function openVault(hook: ReturnType<typeof setup>["hook"]) {
  await waitFor(() => expect(hook.result.current.store.phase).toBe("new"));
  await act(() => hook.result.current.store.createVault("device"));
  await waitFor(() => expect(hook.result.current.store.phase).toBe("ready"));
}

describe("useInvites + useInvitePolling", () => {
  it("creates a pending invite (code in the vault), then auto-enrolls when claimed", async () => {
    const { hook, signer } = setup({ claimAfterMs: 300 });
    await openVault(hook);

    let created: Awaited<ReturnType<typeof hook.result.current.invites.create>> = null;
    await act(async () => {
      created = await hook.result.current.invites.create({ label: "grace", amount: "1500", org: "Acme" });
    });
    expect(hook.result.current.invites.error).toBeNull();
    expect(created).not.toBeNull();
    const inv = hook.result.current.store.invites[0]!;
    expect(inv).toMatchObject({ label: "grace", amount: 1_500_000_000n, employer: signer.address, org: "Acme" });
    expect(inv.code).toMatch(/^0x[0-9a-f]{64}$/);
    expect(hook.result.current.invites.created?.id).toBe(inv.id);
    expect(hook.result.current.invites.rows[0]!.statusText).toBe("Invited (pending)");
    expect(hook.result.current.store.employees).toHaveLength(0);

    await waitFor(() => expect(hook.result.current.store.employees).toHaveLength(1), { timeout: 5_000 });
    const e = hook.result.current.store.employees[0]!;
    expect(e).toMatchObject({ ensName: "grace.soapay.eth", amount: 1_500_000_000n, active: true });
    expect(e.pinHistory[0]!.reason).toBe("enrolled");
    await waitFor(() => expect(hook.result.current.store.invites).toHaveLength(0));
    expect(hook.result.current.invites.created).toBeNull();
  });

  it("shows Re-invite on expiry and replaces the row with a fresh code", async () => {
    const { hook, api } = setup({ claimAfterMs: 60_000 });
    await openVault(hook);
    await act(async () => {
      await hook.result.current.invites.create({ label: "heidi", amount: "10" });
    });
    const first = hook.result.current.store.invites[0]!;
    api.expire(first.codeHash);
    await waitFor(() => expect(hook.result.current.invites.rows[0]!.canReinvite).toBe(true), { timeout: 5_000 });
    expect(hook.result.current.invites.rows[0]!.statusText).toBe("Invite expired");

    await act(async () => {
      await hook.result.current.invites.reinvite(first.id);
    });
    const rows = hook.result.current.store.invites;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.label).toBe("heidi");
    expect(rows[0]!.code).not.toBe(first.code);
    expect(rows[0]!.state.kind).toBe("pending");
  });

  it("explains why invites are unavailable without the API", async () => {
    const { hook } = setup({ claimAfterMs: 0, withApi: false });
    await openVault(hook);
    expect(hook.result.current.invites.unavailable).toMatch(/VITE_API_URL/);
  });
});
