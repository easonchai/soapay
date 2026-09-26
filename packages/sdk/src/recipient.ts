import { isAddress, getAddress, parseUnits, type Hex } from 'viem';
import { parseKeysFromStealthMetaAddress, VALID_SCHEME_ID } from '@scopelift/stealth-address-sdk';

export type ParsedRecipient =
  | { kind: 'ens'; name: string }
  | { kind: 'registrant'; address: Hex }
  | { kind: 'meta'; metaAddress: Hex };

const META_RE = /^st:eth:(0x[0-9a-fA-F]{132})$/;

export function parseRecipient(raw: string): ParsedRecipient {
  const input = raw.trim();
  const m = META_RE.exec(input);
  if (m?.[1]) {
    const metaAddress = m[1].toLowerCase() as Hex;
    try {
      parseKeysFromStealthMetaAddress({ stealthMetaAddress: metaAddress, schemeId: VALID_SCHEME_ID.SCHEME_ID_1 });
    } catch {
      throw new Error('Invalid stealth meta-address: keys are not valid compressed public keys');
    }
    return { kind: 'meta', metaAddress };
  }
  if (input.startsWith('st:')) {
    throw new Error('Invalid stealth meta-address: expected st:eth:0x followed by 132 hex characters');
  }
  if (input.startsWith('0x')) {
    if (!isAddress(input)) throw new Error('Invalid address');
    return { kind: 'registrant', address: getAddress(input) };
  }
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(input)) {
    return { kind: 'ens', name: input.toLowerCase() };
  }
  throw new Error('Not a name, address or meta-address');
}

export function parseAmount(raw: string, decimals: number): bigint {
  const s = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error('Amount must be a positive number');
  const frac = s.split('.')[1] ?? '';
  if (frac.length > decimals) throw new Error(`Amount has more than ${decimals} decimals`);
  const v = parseUnits(s, decimals);
  if (v <= 0n) throw new Error('Amount must be greater than zero');
  return v;
}

export type Pin = { registrant?: Hex | undefined; metaAddress: Hex; pinnedAt: number };

export type Resolved =
  | { status: 'ok'; input: string; registrant?: Hex | undefined; metaAddress: Hex }
  | { status: 'changed'; input: string; registrant?: Hex | undefined; metaAddress: Hex; pinned: Hex }
  | { status: 'error'; input: string; message: string };

export type ResolveDeps = {
  getEnsAddress: (name: string) => Promise<Hex | null>;
  /** Returns '0x' when nothing is registered. */
  getRegistryMeta: (registrant: Hex) => Promise<Hex>;
  pin?: Pin | undefined;
};

export async function resolveRecipient(rawInput: string, deps: ResolveDeps): Promise<Resolved> {
  const input = rawInput.trim();
  let parsed: ParsedRecipient;
  try {
    parsed = parseRecipient(input);
  } catch (e) {
    return { status: 'error', input, message: (e as Error).message };
  }
  try {
    let registrant: Hex | undefined;
    let metaAddress: Hex;
    if (parsed.kind === 'meta') {
      metaAddress = parsed.metaAddress;
    } else {
      if (parsed.kind === 'ens') {
        const addr = await deps.getEnsAddress(parsed.name);
        if (!addr) return { status: 'error', input, message: `Name ${parsed.name} does not resolve to an address` };
        registrant = addr;
      } else {
        registrant = parsed.address;
      }
      const meta = await deps.getRegistryMeta(registrant);
      if (!meta || meta === '0x' || meta.length !== 134) {
        return { status: 'error', input, message: `No stealth meta-address registered for ${registrant}` };
      }
      metaAddress = meta.toLowerCase() as Hex;
    }
    if (deps.pin && deps.pin.metaAddress.toLowerCase() !== metaAddress) {
      return { status: 'changed', input, registrant, metaAddress, pinned: deps.pin.metaAddress };
    }
    return { status: 'ok', input, registrant, metaAddress };
  } catch (e) {
    return { status: 'error', input, message: `Lookup failed: ${(e as Error).message}` };
  }
}

export type BatchLine = { input: string; amountText: string; amount: bigint };

export function parseBatchText(text: string, decimals: number, maxRows: number) {
  const lines: BatchLine[] = [];
  const errors: { line: number; message: string }[] = [];
  text.split(/\r?\n/).forEach((row, i) => {
    if (!row.trim()) return;
    const n = i + 1;
    const parts = row.split(',').map((s) => s.trim());
    const input = parts[0];
    const amountText = parts[1];
    if (parts.length !== 2 || input === undefined || amountText === undefined) {
      errors.push({ line: n, message: 'Expected "recipient, amount"' });
      return;
    }
    try {
      parseRecipient(input);
      const amount = parseAmount(amountText, decimals);
      lines.push({ input, amountText, amount });
    } catch (e) {
      errors.push({ line: n, message: (e as Error).message });
    }
  });
  if (lines.length > maxRows) errors.push({ line: 0, message: `At most ${maxRows} rows per run` });
  return { lines, errors };
}
