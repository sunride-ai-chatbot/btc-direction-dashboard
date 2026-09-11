import { createContext, useContext, type ReactNode } from 'react';
import { useLiveStream, type LiveStreamState } from './api';

// One SSE connection for the whole app: the ticker bar, the chart and the signal
// panel all read the same stream instead of each opening their own.
const LiveContext = createContext<LiveStreamState>({ tick: null, connected: false, lastMove: null, signalVersion: 0 });

export function LiveProvider({ children }: { children: ReactNode }) {
  const live = useLiveStream();
  return <LiveContext.Provider value={live}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveStreamState {
  return useContext(LiveContext);
}
