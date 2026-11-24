'use client';

import { useRouter } from 'next/navigation';
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import type { ApiDeps } from './api';
import { newClientRequestId } from './ids';

/** Everything the client components get from the outside world (plan P-3). */
export interface ClientDeps extends ApiDeps {
  /** `window.localStorage`, or `null` when it cannot be reached. Call it only in effects/handlers. */
  storage: () => Storage | null;
  newId: () => string;
  navigate: (path: string) => void;
}

const ClientDepsContext = createContext<ClientDeps | null>(null);

/** Test seam: provides fake deps to the tree. */
export const ClientDepsProvider = ClientDepsContext.Provider;

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// Wrapper functions, never the bare globals: a bare `fetch` can throw "illegal invocation".
function RouterDeps({ children }: { children: ReactNode }) {
  const router = useRouter();
  const deps = useMemo<ClientDeps>(
    () => ({
      fetch: (...args) => globalThis.fetch(...args),
      setTimeout: (handler, ms) => window.setTimeout(handler, ms),
      clearTimeout: (id) => window.clearTimeout(id as number),
      storage: browserStorage,
      newId: () => newClientRequestId(),
      navigate: (path) => router.push(path),
    }),
    [router],
  );
  return <ClientDepsContext.Provider value={deps}>{children}</ClientDepsContext.Provider>;
}

/** Uses the injected deps when a provider exists; otherwise the browser ones (needs the app router). */
export function WithClientDeps({ children }: { children: ReactNode }) {
  const injected = useContext(ClientDepsContext);
  if (injected !== null) return <>{children}</>;
  return <RouterDeps>{children}</RouterDeps>;
}

export function useClientDeps(): ClientDeps {
  const deps = useContext(ClientDepsContext);
  if (deps === null) throw new Error('ClientDeps missing: wrap the tree in <WithClientDeps>');
  return deps;
}
