import { useState } from "react";
import type { CampaignLadderResponse, CampaignWorld } from "@/api/client";
import { useT } from "@/i18n/useT";
import { pickCurrentWorld } from "@/lib/campaign";
import { HomeHeader } from "@/screens/home/HomeHeader";
import { ProfileMenu } from "@/screens/home/ProfileMenu";
import { StarterCurrentWorld } from "@/screens/campaign/components/starter/StarterCurrentWorld";
import { StarterHero } from "@/screens/campaign/components/starter/StarterHero";
import { StarterWorldRow } from "@/screens/campaign/components/starter/StarterWorldRow";
import { useSessionStore } from "@/store/session";

const shell: React.CSSProperties = {
  width: "100%",
  maxWidth: 480,
  minHeight: "100dvh",
  margin: "0 auto",
  // Slimmer side gutters so every section reads as a broad panel (matches the reference width);
  // top clears the status bar; bottom clears the floating bottom nav with room for the last world.
  padding:
    "calc(clamp(10px, 3vw, 14px) + env(safe-area-inset-top)) clamp(11px, 3.2vw, 14px) calc(132px + env(safe-area-inset-bottom))",
  display: "flex",
  flexDirection: "column",
  gap: 15,
  // NO background of its own. This hub serves every NORMAL theme, half of which are dark, and it
  // used to paint a fixed near-white ivory field over all of them — so equipping Midnight Arcade
  // left the campaign a cream page inside a black app. `body` already paints `var(--bg)`, the
  // theme's own lit room with the root's vignette and grain (global.css); the ladder shell next
  // door has always let it through, and now the hub matches. Same fix as the Leaderboard's shell.
};

/**
 * The Starter-system campaign hub — the reference redesign that serves every NORMAL theme (Starter
 * + its skins). A branded header, the "Campaign" banner, the spotlighted current world, and a row
 * per remaining world. The Minimal pair (art-less) keeps its quiet list and Rot Champion keeps its
 * cosmic board — this component only renders when the equipped theme carries the Starter art set.
 */
export function StarterCampaignHub({
  ladder,
  onPick,
  onVault,
  offlineAction,
}: {
  ladder: CampaignLadderResponse;
  onPick: (world: CampaignWorld) => void;
  onVault?: () => void;
  /** The offline-download control. The hub's branded header owns the page's top-right corner, so
   * instead of a fixed overlay it rides inside the hero card as a small banner (see StarterHero). */
  offlineAction?: React.ReactNode;
}) {
  const t = useT();
  const me = useSessionStore((s) => s.me);
  const [menuOpen, setMenuOpen] = useState(false);

  const currentName = pickCurrentWorld(ladder.worlds);
  const current = ladder.worlds.find((w) => w.world === currentName) ?? ladder.worlds[0] ?? null;
  const others = current ? ladder.worlds.filter((w) => w.world !== current.world) : ladder.worlds;
  const openVault = onVault ?? (() => {});

  return (
    <main style={shell}>
      {me && (
        <HomeHeader
          coins={me.coins_balance}
          avatarPreset={me.avatar_preset}
          equippedFrame={me.equipped_frame}
          onOpenMenu={() => setMenuOpen(true)}
          onOpenVault={openVault}
        />
      )}

      <StarterHero ladder={ladder} offlineAction={offlineAction} />

      {current && <StarterCurrentWorld world={current} onPick={() => onPick(current)} />}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {others.map((w) => (
          <StarterWorldRow key={w.world} world={w} onPick={() => onPick(w)} />
        ))}
      </div>

      <p style={{ textAlign: "center", fontSize: 11, fontWeight: 500, color: "var(--faint)", margin: "2px 8px 0" }}>
        {t.campaign.cosmeticNote}
      </p>

      {menuOpen && me && (
        <ProfileMenu
          username={me.username}
          avatarPreset={me.avatar_preset}
          equippedFrame={me.equipped_frame}
          equippedBadges={me.equipped_badges}
          equippedTitle={me.equipped_title}
          onClose={() => setMenuOpen(false)}
          onOpenVault={() => {
            setMenuOpen(false);
            openVault();
          }}
        />
      )}
    </main>
  );
}
