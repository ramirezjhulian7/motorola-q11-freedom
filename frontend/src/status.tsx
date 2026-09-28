import { createContext, useContext, type ReactNode } from 'react';
import { usePoll } from './lib/usePoll';
import { getStatus, type NodeStatus } from './lib/meshApi';

interface StatusCtx {
  status: NodeStatus | null;
  error: Error | null;
  refresh: () => Promise<void>;
}

const Ctx = createContext<StatusCtx>(null!);

/** `status` of the node we're talking to, shared by every page. */
export function StatusProvider({ children }: { children: ReactNode }) {
  const { data, error, refresh } = usePoll(getStatus, 15_000);
  return <Ctx.Provider value={{ status: data, error, refresh }}>{children}</Ctx.Provider>;
}

export const useStatus = () => useContext(Ctx);

/** Status once loaded (pages render only after the gate in App has it). */
export const useNode = () => useContext(Ctx).status!;
