'use client';

import { useSyncExternalStore } from 'react';

import { sessionStore, type SessionState } from './session-store';

const getSnapshot = (): SessionState => sessionStore.getState();

export function useSession(): SessionState {
  return useSyncExternalStore(sessionStore.subscribe, getSnapshot, getSnapshot);
}
