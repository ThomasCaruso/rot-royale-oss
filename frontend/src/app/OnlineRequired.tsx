import { useT } from "@/i18n/useT";
import { GlassCard } from "@/ui/GlassCard";
import { GoldButton } from "@/ui/GoldButton";

/**
 * Calm "back online to play this" panel shown INSTEAD of a ranked/social surface while the device is
 * offline (see offlineGate.requiresOnline). No motion beyond the shared primitives — the message
 * itself carries the meaning, so it reads fine under prefers-reduced-motion.
 */
export function OnlineRequired({ onBack, label }: { onBack: () => void; label?: string }) {
  const t = useT();
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        boxSizing: "border-box",
      }}
    >
      <GlassCard style={{ padding: 28, textAlign: "center", maxWidth: 340 }}>
        <div style={{ fontSize: 40, marginBottom: 8 }} aria-hidden>
          📡
        </div>
        <h2 className="display" style={{ margin: "0 0 8px", fontSize: 24 }}>
          {label ?? t.offline.requiredTitle}
        </h2>
        <p style={{ margin: "0 0 20px", color: "var(--muted)", lineHeight: 1.5 }}>
          {t.offline.requiredBody}
        </p>
        <GoldButton onClick={onBack} idlePulse={false}>
          {t.common.back}
        </GoldButton>
      </GlassCard>
    </main>
  );
}
