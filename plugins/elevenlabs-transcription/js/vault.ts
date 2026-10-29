import { callNativeMethod } from '@valenced/modules/native';
import { SafeError } from './core.js';
import type { Vault } from './key-state.js';
const call = callNativeMethod as unknown as (name: string, args: unknown[]) => Promise<unknown>;
async function operation(name: string, args: unknown[] = []): Promise<string | null> {
  try {
    const result = await call(`anezium.elevenlabs.vault.${name}`, args) as { ok?: boolean; key?: unknown };
    if (!result || result.ok !== true) throw new Error();
    if (name === 'load') {
      if (result.key !== null && typeof result.key !== 'string') throw new Error();
      return result.key;
    }
    return null;
  } catch { throw new SafeError('vault', 'Android vault unavailable or key invalidated. No plaintext storage. Retry or delete the key before replacing it.'); }
}
export const nativeVault: Vault = {
  load: () => operation('load'),
  save: async key => { await operation('save', [key]); },
  delete: async () => { await operation('delete'); },
};
export async function reserveAutomaticIdentity(identity: string): Promise<boolean> {
  try {
    const result = await call('anezium.elevenlabs.auto.reserve', [identity]) as { ok?: boolean; reserved?: boolean };
    if (!result || result.ok !== true || typeof result.reserved !== 'boolean') throw new Error();
    return result.reserved;
  } catch { throw new SafeError('journal', 'Durable reservation unavailable or full. No automatic processing.'); }
}
