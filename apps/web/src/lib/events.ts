import { useEffect, useRef } from 'react';
import type { WsEvent } from '@gameserver/shared';

type Listener = (e: WsEvent) => void;
const listeners = new Set<Listener>();

/** Verteilt WebSocket-Ereignisse (vom AuthProvider empfangen) an beliebige Komponenten. */
export function emitWsEvent(e: WsEvent): void {
  for (const l of listeners) l(e);
}

export function onWsEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Hook-Variante; der Listener darf sich bei jedem Rendern ändern. */
export function useWsEvent(listener: Listener): void {
  const ref = useRef(listener);
  ref.current = listener;
  useEffect(() => onWsEvent((e) => ref.current(e)), []);
}
