import { useEffect, useRef } from 'react';

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Wählt das nächste Element in einer Richtung (räumliche Navigation für Controller/Fernbedienung).
 * Nur Kandidaten, die in der Richtung liegen; Abstand in Hauptrichtung zählt einfach, seitliche Abweichung doppelt –
 * so springt der Fokus bevorzugt in derselben Reihe/Spalte weiter.
 */
export function pickNext(from: Box, candidates: Box[], dir: Direction): number {
  const cx = from.x + from.w / 2;
  const cy = from.y + from.h / 2;
  let best = -1;
  let bestScore = Infinity;
  candidates.forEach((c, i) => {
    const ox = c.x + c.w / 2;
    const oy = c.y + c.h / 2;
    let main: number;
    let cross: number;
    switch (dir) {
      case 'right':
        main = c.x - (from.x + from.w);
        cross = Math.abs(oy - cy);
        if (ox <= cx + 1) return;
        break;
      case 'left':
        main = from.x - (c.x + c.w);
        cross = Math.abs(oy - cy);
        if (ox >= cx - 1) return;
        break;
      case 'down':
        main = c.y - (from.y + from.h);
        cross = Math.abs(ox - cx);
        if (oy <= cy + 1) return;
        break;
      case 'up':
        main = from.y - (c.y + c.h);
        cross = Math.abs(ox - cx);
        if (oy >= cy - 1) return;
        break;
    }
    const score = Math.max(0, main) + cross * 2;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

const SELECTOR = '[data-nav]:not([disabled])';

function boxOf(el: Element): Box {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

/** Fokus in eine Richtung bewegen (innerhalb von `root`) */
export function moveFocus(root: HTMLElement, dir: Direction): boolean {
  const items = [...root.querySelectorAll<HTMLElement>(SELECTOR)].filter((e) => e.offsetParent !== null);
  if (!items.length) return false;
  const active = document.activeElement as HTMLElement | null;
  if (!active || !items.includes(active)) {
    items[0].focus();
    return true;
  }
  const others = items.filter((e) => e !== active);
  const idx = pickNext(boxOf(active), others.map(boxOf), dir);
  if (idx < 0) return false;
  others[idx].focus();
  others[idx].scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  return true;
}

export interface NavHandlers {
  onBack?: () => void;
  /** LB/RB bzw. Q/E: Bereich wechseln */
  onPrevSection?: () => void;
  onNextSection?: () => void;
  /** Start/Menü-Taste */
  onMenu?: () => void;
}

/**
 * Tastatur (Pfeile, Enter, Escape/Backspace, Q/E) und Gamepad (Steuerkreuz/linker Stick, A, B, LB/RB, Start)
 * für den Big-Picture-Modus. Gamepads werden per requestAnimationFrame abgefragt (Gamepad-API).
 */
export function useSpatialNav(rootRef: React.RefObject<HTMLElement | null>, handlers: NavHandlers): void {
  const h = useRef(handlers);
  h.current = handlers;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      const map: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
      if (map[e.key] && !(typing && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))) {
        if (moveFocus(root, map[e.key])) e.preventDefault();
      } else if ((e.key === 'Escape' || (e.key === 'Backspace' && !typing)) && h.current.onBack) {
        e.preventDefault();
        h.current.onBack();
      } else if (!typing && e.key.toLowerCase() === 'q') h.current.onPrevSection?.();
      else if (!typing && e.key.toLowerCase() === 'e') h.current.onNextSection?.();
    };
    window.addEventListener('keydown', onKey);

    // Gamepad: Flanken erkennen, gehaltene Richtungen wiederholen
    const prev: Record<string, boolean> = {};
    const repeatAt: Record<string, number> = {};
    let frame = 0;
    const poll = () => {
      const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
      const pad = [...pads].find((p) => p && p.connected);
      if (pad) {
        const b = (i: number) => !!pad.buttons[i]?.pressed;
        const ax = pad.axes[0] ?? 0;
        const ay = pad.axes[1] ?? 0;
        const state: Record<string, boolean> = {
          up: b(12) || ay < -0.6,
          down: b(13) || ay > 0.6,
          left: b(14) || ax < -0.6,
          right: b(15) || ax > 0.6,
          a: b(0),
          b: b(1),
          lb: b(4),
          rb: b(5),
          start: b(9),
        };
        const now = performance.now();
        for (const [k, pressed] of Object.entries(state)) {
          const edge = pressed && !prev[k];
          const repeat = pressed && prev[k] && ['up', 'down', 'left', 'right'].includes(k) && now >= (repeatAt[k] ?? Infinity);
          if (edge || repeat) {
            repeatAt[k] = now + (edge ? 400 : 120);
            if (k === 'up' || k === 'down' || k === 'left' || k === 'right') moveFocus(root, k);
            else if (k === 'a') (document.activeElement as HTMLElement | null)?.click();
            else if (k === 'b') h.current.onBack?.();
            else if (k === 'lb') h.current.onPrevSection?.();
            else if (k === 'rb') h.current.onNextSection?.();
            else if (k === 'start') h.current.onMenu?.();
          }
          prev[k] = pressed;
        }
      }
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => {
      window.removeEventListener('keydown', onKey);
      cancelAnimationFrame(frame);
    };
  }, [rootRef]);
}
