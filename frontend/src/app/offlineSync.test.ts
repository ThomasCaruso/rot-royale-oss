import { describe, it, expect, vi } from "vitest";
import { onReconnect, onForegroundDrain } from "./reconnect";

describe("reconnect helper", () => {
  it("onReconnect drains the outbox and re-pulls offline content", () => {
    const drainOutbox = vi.fn().mockResolvedValue(undefined);
    const refreshOfflineContent = vi.fn().mockResolvedValue(undefined);
    const refreshMe = vi.fn().mockResolvedValue(undefined);

    onReconnect({ drainOutbox, refreshOfflineContent, refreshMe });

    expect(drainOutbox).toHaveBeenCalledTimes(1);
    expect(refreshOfflineContent).toHaveBeenCalledTimes(1);
    // onReconciled wired to refreshMe (not called until an item reconciles).
    const deps = drainOutbox.mock.calls[0][0];
    expect(typeof deps.onReconciled).toBe("function");
    deps.onReconciled();
    expect(refreshMe).toHaveBeenCalledTimes(1);
  });

  it("onForegroundDrain drains but does NOT re-pull content", () => {
    const drainOutbox = vi.fn().mockResolvedValue(undefined);
    const refreshMe = vi.fn().mockResolvedValue(undefined);

    onForegroundDrain({ drainOutbox, refreshMe });

    expect(drainOutbox).toHaveBeenCalledTimes(1);
  });

  it("simulated false→true transition triggers exactly one reconnect drain", () => {
    // Mirrors App's subscribe(): only the offline→online edge fires onReconnect.
    const drainOutbox = vi.fn().mockResolvedValue(undefined);
    const refreshOfflineContent = vi.fn().mockResolvedValue(undefined);
    const refreshMe = vi.fn().mockResolvedValue(undefined);
    const deps = { drainOutbox, refreshOfflineContent, refreshMe };

    let wasOnline = false;
    const onChange = (online: boolean) => {
      if (online && !wasOnline) onReconnect(deps);
      wasOnline = online;
    };

    onChange(false); // still offline — no drain
    onChange(true); // false → true — drain once
    onChange(true); // stays online — no extra drain
    onChange(false); // goes offline — no drain

    expect(drainOutbox).toHaveBeenCalledTimes(1);
    expect(refreshOfflineContent).toHaveBeenCalledTimes(1);
  });
});
