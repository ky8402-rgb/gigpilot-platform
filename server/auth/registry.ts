/**
 * Auth provider registry.
 *
 * Selects the active OwnerAuthProvider based on the `AUTH_PROVIDER` env
 * var. Defaults to `totp` (the existing TOTP + password implementation).
 *
 * Adding a new provider is a three-step process:
 *   1) implement the OwnerAuthProvider interface,
 *   2) add the implementation here under the matching id,
 *   3) the operator flips AUTH_PROVIDER on the next deploy.
 *
 * The registry refuses to start with an unknown provider id — fail-closed.
 */

import { OwnerAuthProvider } from './types.js';
import { TotpPasswordAuthProvider } from './TotpPasswordAuthProvider.js';

export interface AuthProviderRegistryOptions {
  /** Override the env-var lookup. Used by tests. */
  providerId?: string;
}

export function selectAuthProvider(opts: AuthProviderRegistryOptions = {}): OwnerAuthProvider {
  const id = (opts.providerId ?? process.env.AUTH_PROVIDER ?? 'totp').trim().toLowerCase();
  switch (id) {
    case 'totp':
    case 'totp+password':
      return new TotpPasswordAuthProvider();
    default:
      throw new Error(
        `Unknown AUTH_PROVIDER=${id}. Supported: 'totp'. ` +
          `To add a new provider, implement OwnerAuthProvider and register it in server/auth/registry.ts.`,
      );
  }
}
