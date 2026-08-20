import { create } from "zustand";
import { Network } from "@capacitor/network";

interface NetworkState {
  online: boolean;
}
export const useNetwork = create<NetworkState>(() => ({
  online: typeof navigator === "undefined" ? true : navigator.onLine,
}));

export function setOnline(online: boolean): void {
  if (useNetwork.getState().online !== online) useNetwork.setState({ online });
}

/** Wire real network events. Call once at app bootstrap. Returns a teardown fn. */
export function startNetworkWatch(): () => void {
  let remove: (() => void) | undefined;
  Network.addListener("networkStatusChange", (s) => setOnline(s.connected))
    .then((h) => {
      remove = () => void h.remove();
    })
    .catch(() => undefined);
  const onl = () => setOnline(true);
  const off = () => setOnline(false);
  if (typeof window !== "undefined") {
    window.addEventListener("online", onl);
    window.addEventListener("offline", off);
  }
  Network.getStatus()
    .then((s) => setOnline(s.connected))
    .catch(() => undefined);
  return () => {
    remove?.();
    if (typeof window !== "undefined") {
      window.removeEventListener("online", onl);
      window.removeEventListener("offline", off);
    }
  };
}
