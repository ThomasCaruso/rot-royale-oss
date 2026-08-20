import { useEffect } from "react";

/**
 * A LIFO stack of Android BACK interceptors.
 *
 * The App-level handler only knows about App-level state (`vaultOpen`, `campaignOpen`, …). Plenty
 * of full-screen surfaces own their own state inside child components — the Daily Royale results
 * modal and the Rot Report in `Home`, the LIVE duel and friend detail in `FriendsScreen`, the
 * identity editor, the rename sheet. Back on any of those used to miss every App-level branch and
 * fall through to `exitApp()`: reading your results, press back, the app closes.
 *
 * The live duel was worse than that — back matched `friendsOpen` and tore down the whole Friends
 * screen mid-match against a real person.
 *
 * So a component that puts a dismissable layer on screen registers here while it's open. The stack
 * is consulted before any App-level handling, newest first, which is the order they're stacked
 * visually. An interceptor returns true if it consumed the press.
 */
type Interceptor = () => boolean;

const stack: Interceptor[] = [];

/** Run the topmost interceptor that consumes the press. Returns true if one did. */
export function runBackInterceptors(): boolean {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    if (stack[i]()) return true;
  }
  return false;
}

/**
 * Register `handler` as the topmost back interceptor while `active` is true.
 *
 * Android-only in effect — nothing else dispatches to this stack — so registering costs iOS and
 * the web nothing.
 */
export function useBackInterceptor(active: boolean, handler: Interceptor): void {
  useEffect(() => {
    if (!active) return;
    stack.push(handler);
    return () => {
      // Remove by identity, not by pop: effect teardown order is not guaranteed to mirror mount
      // order when several layers close at once, and popping blindly would drop someone else's.
      const i = stack.lastIndexOf(handler);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [active, handler]);
}

/** Test seam — the stack is module state, so it must be resettable between cases. */
export function __resetBackInterceptors(): void {
  stack.length = 0;
}
