import { describe, expect, it, vi } from "vitest";
import { generateMnemonic, keysFromMnemonic } from "@soapay/sdk";
import type { Address } from "viem";
import { detectGeneration, keysForGeneration } from "../src/features/rotation/keys.js";
import { readRegisteredMeta, registerMetaAddress } from "../src/onboarding/actions.js";
import type { Api } from "../src/api/client.js";

// A restore recreates generation 0; a rotated account must continue from the generation it reached,
// never re-register generation 0 (that would point the registry and the name back at old keys).
describe("restore after rotation", () => {
  const mnemonic = generateMnemonic();
  const gen0 = keysFromMnemonic(mnemonic);
  const gen2 = keysForGeneration(mnemonic, 2);
  const metaBytes = (uri: string) => uri.replace(/^st:eth:/, "") as `0x${string}`;
  const reader = (uri: string | null) => ({
    readContract: vi.fn(async (args: { functionName: string }) => {
      if (args.functionName === "stealthMetaAddressOf") return uri ? metaBytes(uri) : "0x";
      if (args.functionName === "nonceOf") return 0n;
      throw new Error(`unexpected ${args.functionName}`);
    }),
  });
  const api = () => ({ register: vi.fn(async () => ({ txHash: "0xabc", status: "pending" })) }) as unknown as Api & { register: ReturnType<typeof vi.fn> };

  it("detectGeneration finds the generation a meta-address belongs to", () => {
    expect(detectGeneration(mnemonic, gen0.metaAddressURI)).toBe(0);
    expect(detectGeneration(mnemonic, gen2.metaAddressURI.toUpperCase().replace("ST:ETH:0X", "st:eth:0x"))).toBe(2);
    expect(detectGeneration(mnemonic, keysFromMnemonic(generateMnemonic()).metaAddressURI, 0, 4)).toBeNull();
  });

  it("readRegisteredMeta returns null for an empty registry entry", async () => {
    expect(await readRegisteredMeta(reader(null) as never, gen0.registrantAddress as Address)).toBeNull();
    expect(await readRegisteredMeta(reader(gen2.metaAddressURI) as never, gen0.registrantAddress as Address)).toBe(gen2.metaAddressURI.toLowerCase());
  });

  it("a restored account on generation 2 keeps it and sends nothing", async () => {
    const a = api();
    const r = await registerMetaAddress({ api: a, client: reader(gen2.metaAddressURI) as never, keys: gen0, chainId: 84532, restore: { mnemonic } });
    expect(r).toMatchObject({ idempotent: true, generation: 2 });
    expect(a.register).not.toHaveBeenCalled();
  });

  it("a new account still registers generation 0", async () => {
    const a = api();
    const r = await registerMetaAddress({ api: a, client: reader(null) as never, keys: gen0, chainId: 84532, restore: { mnemonic } });
    expect(r.generation).toBeUndefined();
    expect(a.register).toHaveBeenCalledOnce();
  });
});
