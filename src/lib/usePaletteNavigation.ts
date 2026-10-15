import { useRef } from "react";

/** Helyi: a nyitott paletta pane-lépése (státuszszűrő-léptetés); a useShortcuts hívja, ha be van állítva. */
export function usePaletteNavigation() {
  return useRef<((direction: -1 | 1) => void) | null>(null);
}
