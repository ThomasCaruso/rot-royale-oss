export type LeaderboardTab = "window" | "global";

export function LeaderboardTabs({
  active,
  onSwitch,
  labels,
}: {
  active: LeaderboardTab;
  onSwitch: (tab: LeaderboardTab) => void;
  labels: { currentWindow: string; globalRank: string };
}) {
  return (
    <div
      role="tablist"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 3,
        padding: 3,
        borderRadius: 13,
        // A recessed segmented control ON the arena — no outer border, just an inset track.
        background: "rgba(0,0,0,.24)",
        boxShadow: "inset 0 1px 3px rgba(0,0,0,.5)",
      }}
    >
      <TabButton label={labels.currentWindow} active={active === "window"} onClick={() => onSwitch("window")} />
      <TabButton label={labels.globalRank} active={active === "global"} onClick={() => onSwitch("global")} />
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        position: "relative",
        flex: 1,
        padding: "7px 12px 9px",
        borderRadius: 11,
        border: "none",
        cursor: active ? "default" : "pointer",
        fontFamily: "Fredoka, sans-serif",
        fontWeight: 800,
        fontSize: 12.5,
        letterSpacing: "0.02em",
        transition: "background 180ms, color 180ms",
        background: active
          ? "linear-gradient(180deg, color-mix(in srgb, var(--brand-2) 70%, transparent), color-mix(in srgb, var(--brand) 80%, black))"
          : "transparent",
        color: active ? "var(--text)" : "var(--muted)",
        boxShadow: active ? "inset 0 1px 0 rgba(255,255,255,.12)" : "none",
      }}
    >
      {label}
      {/* Small gold dot under the active label. */}
      {active && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            bottom: 4,
            left: "50%",
            transform: "translateX(-50%)",
            width: 4,
            height: 4,
            borderRadius: "50%",
            background: "var(--amber)",
            boxShadow: "0 0 6px var(--amber)",
          }}
        />
      )}
    </button>
  );
}
