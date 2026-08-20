import { useEffect, useRef, useState } from "react";
import { api, type VaultItem } from "@/api/client";
import { lobbyArt } from "@/assets/lobby";
import { errorMessage } from "@/i18n/errors";
import { fmt, useT } from "@/i18n/useT";
import { useSessionStore } from "@/store/session";
import { getTheme } from "@/theme/tokens";
import { getFrame } from "@/theme/identity";
import { Avatar } from "@/screens/home/Avatar";
import { CoinIcon } from "@/ui/CoinIcon";
import { GemIcon } from "@/ui/GemIcon";
import { Confetti } from "@/ui/Confetti";
import { Display } from "@/ui/Display";
import { FitText } from "@/ui/FitText";
import { GoldButton } from "@/ui/GoldButton";
import { ThemePreview } from "@/screens/vault/ThemePreview";
import { VaultItemCard } from "@/screens/vault/VaultItemCard";
import { FrameCard } from "@/screens/vault/FrameCard";
import { RARITY_META, groupByRarity, type Rarity } from "@/screens/vault/rarity";
import { StarterVault } from "@/screens/vault/StarterVault";
import { Skeleton } from "@/ui/Skeleton";
import { useArtStyle, useThemeArt } from "@/theme/useArtStyle";

type VaultTab = "themes" | "frames";

/**
 * The Vault: spend coins on themes and avatar frames (cosmetic-only — the subtitle says so
 * explicitly). A Themes | Frames segmented control (same pattern as LeaderboardTabs) splits the
 * server catalog by `kind`; load/buy/equip plumbing is shared across both tabs.
 * All coin/ownership state comes from SERVER responses: GET /vault renders, buy/equip responses
 * patch — there is no client-side coin math and no optimistic flip. Buttons disable while a
 * mutation is in flight; a 409 on buy is treated as "already owned" → just refetch.
 *
 * Game-feel layer (purely presentational, server contracts untouched):
 *  - theme cards carry a live ThemePreview; frame cards preview the player's own avatar
 *  - per tab, the cheapest affordable unowned item is the `spotlight` (gold glow = next action)
 *  - a successful buy plays Confetti + a one-shot splash/shine on the newly-owned card
 *  - decorative motion rides the global prefers-reduced-motion collapse in global.css
 */
export function VaultScreen({ onBack }: { onBack: () => void }) {
  const t = useT();
  const setMe = useSessionStore((s) => s.setMe);
  const mono = useArtStyle() === "mono";
  const themeArt = useThemeArt();
  const avatarPreset = useSessionStore((s) => s.me?.avatar_preset);
  const equippedFrame = useSessionStore((s) => s.me?.equipped_frame) ?? null;
  const [tab, setTab] = useState<VaultTab>("themes");
  const [items, setItems] = useState<VaultItem[] | null>(null);
  const [balance, setBalance] = useState(0);
  // The Gem wallet (duel currency) — tracked alongside coins so Gem-priced frames show their own
  // balance/affordability against the right wallet (a coin balance never unlocks a Gem frame).
  const [gemsBalance, setGemsBalance] = useState(0);
  const [confirming, setConfirming] = useState<VaultItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [burst, setBurst] = useState(0);
  const [justUnlocked, setJustUnlocked] = useState<string | null>(null);
  // A failed buy/equip surfaces WHY (localized) instead of silently closing the sheet — the old
  // catch-and-refresh made a refused purchase look like the button simply did nothing.
  const [actionError, setActionError] = useState("");
  // First load failed and there's nothing to render — offer retry instead of an empty catalog.
  const [loadError, setLoadError] = useState(false);
  // Unmount guard: any post-await setState is gated on this ref so we never update
  // state after the component has unmounted (mirrors LeaderboardScreen's `cancelled` pattern).
  const mountedRef = useRef(true);

  async function refresh() {
    const res = await api.vault();
    if (!mountedRef.current) return;
    setItems(res.items);
    setBalance(res.coins_balance);
    setGemsBalance(res.gems_balance);
    setLoadError(false);
  }

  useEffect(() => {
    mountedRef.current = true;
    refresh().catch(() => { if (mountedRef.current) setLoadError(true); });
    return () => { mountedRef.current = false; };
  }, []);

  // The unlock splash/shine is one-shot: clear the flag once the 1.5s animation has played, so a
  // later re-render (equipping something else, a refetch) can't replay it on a stale card.
  useEffect(() => {
    if (!justUnlocked) return;
    const timer = setTimeout(() => {
      if (mountedRef.current) setJustUnlocked(null);
    }, 1800);
    return () => clearTimeout(timer);
  }, [justUnlocked]);

  // Error toast auto-dismisses; any new action clears it immediately.
  useEffect(() => {
    if (!actionError) return;
    const timer = setTimeout(() => {
      if (mountedRef.current) setActionError("");
    }, 4000);
    return () => clearTimeout(timer);
  }, [actionError]);

  async function buy(item: VaultItem) {
    if (!mountedRef.current) return;
    setBusy(true);
    setActionError("");
    try {
      const res = await api.buyVaultItem(item.id);
      if (!mountedRef.current) return;
      // The buy response carries BOTH wallets post-debit — patch both so the coin pill and the gem
      // pill stay correct no matter which currency the purchase spent.
      setBalance(res.coins_balance);
      setGemsBalance(res.gems_balance);
      // Fix 4: read fresh state via the store's imperative getter instead of closing over me
      const freshMe = useSessionStore.getState().me;
      if (freshMe)
        setMe({ ...freshMe, coins_balance: res.coins_balance, gems_balance: res.gems_balance });
      setBurst((k) => k + 1); // one celebratory burst; Confetti is reduced-motion aware
      setJustUnlocked(item.id); // one-shot splash/shine on the newly-owned card (decorative)
      await refresh();
    } catch (err) {
      if (mountedRef.current) setActionError(errorMessage(err, t, t.errors.server_error));
      await refresh().catch(() => undefined); // server state wins (e.g. 409 already-owned)
    } finally {
      if (mountedRef.current) {
        setBusy(false);
        setConfirming(null);
      }
    }
  }

  async function equip(item: VaultItem) {
    if (!mountedRef.current) return;
    setBusy(true);
    setActionError("");
    try {
      const res = await api.equipVaultItem(item.id);
      if (!mountedRef.current) return;
      // Fix 4: read fresh state via the store's imperative getter. The equip response always
      // carries BOTH fields (post-equip profile) — patching both means a theme equip reskins the
      // app instantly AND a frame equip re-renders the header avatar instantly.
      const freshMe = useSessionStore.getState().me;
      if (freshMe)
        setMe({
          ...freshMe,
          equipped_theme: res.equipped_theme,
          equipped_frame: res.equipped_frame,
        });
      await refresh();
    } catch (err) {
      if (mountedRef.current) setActionError(errorMessage(err, t, t.errors.server_error));
      await refresh().catch(() => undefined);
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  // Items split by kind; only the active tab's list renders.
  const visible =
    items?.filter((i) => (tab === "frames" ? i.kind === "frame" : i.kind === "theme")) ?? null;

  // The obvious next action: the cheapest item you can unlock RIGHT NOW gets the gold glow —
  // computed PER TAB over that tab's items, derived from server data only (item.cost + server
  // balance); none affordable → no spotlight.
  const spotlightId =
    visible?.reduce<VaultItem | null>((best, i) => {
      // Compare each item against ITS wallet (coins vs gems), so the gold "next unlock" glow only
      // lands on something the matching balance can actually afford.
      const bal = i.currency === "gems" ? gemsBalance : balance;
      if (i.owned || i.locked || bal < i.cost) return best;
      return best === null || i.cost < best.cost ? i : best;
    }, null)?.id ?? null;

  // Localized failure toast, shared by both vault layouts (fixed overlay, auto-dismisses).
  const errorToast = actionError ? (
    <div
      role="alert"
      style={{
        position: "fixed",
        top: "calc(14px + env(safe-area-inset-top))",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 40,
        width: "calc(100% - 48px)",
        maxWidth: 360,
        padding: "10px 16px",
        borderRadius: 14,
        background: "var(--panel)",
        border: "1px solid color-mix(in srgb, var(--pink) 55%, transparent)",
        color: "var(--pink)",
        fontWeight: 700,
        fontSize: 13,
        textAlign: "center",
        boxShadow: "0 10px 30px rgba(0,0,0,.35)",
      }}
    >
      {actionError}
    </div>
  ) : null;

  // First load failed with nothing to show: error + retry + back, never a silent empty catalog.
  if (loadError && items === null) {
    return (
      <main
        style={{
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          padding: 24,
        }}
      >
        <div style={{ color: "var(--pink)", fontWeight: 700, marginBottom: 8 }}>
          {t.errors.server_error}
        </div>
        <GoldButton
          idlePulse={false}
          onClick={() => {
            setLoadError(false);
            refresh().catch(() => {
              if (mountedRef.current) setLoadError(true);
            });
          }}
          style={{ maxWidth: 240 }}
        >
          {t.common.retry}
        </GoldButton>
        <GoldButton idlePulse={false} onClick={onBack} style={{ maxWidth: 240 }}>
          {t.common.back}
        </GoldButton>
      </main>
    );
  }

  // The Starter system (mono surface WITH the Starter art set) gets the boutique composition —
  // featured equipped card, product shelf, informational strip. The art-less Blank pair and the
  // arcade skin keep the original rarity-grouped list below. Both share this component's server
  // plumbing; only the presentation differs.
  if (mono && themeArt) {
    return (
      <>
        {burst > 0 && <Confetti burstKey={burst} count={90} />}
        {errorToast}
        <StarterVault
          tab={tab}
          onTab={setTab}
          onBack={onBack}
          items={items}
          balance={balance}
          gemsBalance={gemsBalance}
          equippedFrameId={equippedFrame}
          avatarPreset={avatarPreset}
          busy={busy}
          onBuy={(item) => setConfirming(item)}
          onEquip={equip}
        />
        {confirming && (
          <ConfirmSheet
            item={confirming}
            busy={busy}
            onCancel={() => setConfirming(null)}
            onConfirm={() => buy(confirming)}
          />
        )}
      </>
    );
  }

  return (
    <main
      style={{
        position: "relative",
        minHeight: "100dvh",
        padding: "calc(18px + env(safe-area-inset-top)) 16px calc(110px + env(safe-area-inset-bottom))",
        maxWidth: 480,
        margin: "0 auto",
      }}
    >
      {burst > 0 && <Confetti burstKey={burst} count={90} />}
      {errorToast}

      {/* Treasure-room aura behind the header — a faint gold radial (decorative, GPU-cheap). */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: -30,
          left: "50%",
          transform: "translateX(-50%)",
          width: 360,
          height: 220,
          background: "radial-gradient(closest-side, rgba(255,201,30,.13), transparent 70%)",
          pointerEvents: "none",
        }}
      />

      <header
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <button
          type="button"
          onClick={onBack}
          aria-label={t.vault.back}
          style={{
            border: "none",
            background: "transparent",
            color: "var(--muted)",
            fontWeight: 800,
            cursor: "pointer",
            fontSize: 15,
            minHeight: 44,
            padding: "0 8px 0 0",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          ← {t.vault.back}
        </button>
        {/* Two wallets, two pills: gold coins + cyan/violet Gems. Both always visible so the player
            sees what each cosmetic tier costs from. The number pops on every server-driven change. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Coin pill: gold ring + glow. */}
          <div
            aria-label={fmt(t.vault.balance, { n: balance })}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              padding: "9px 13px",
              minHeight: 44,
              borderRadius: 999,
              background: "var(--panel)",
              border: "1px solid rgba(255,201,30,.5)",
              boxShadow: "0 0 18px rgba(255,201,30,.18), inset 0 1px 0 rgba(255,255,255,.07)",
            }}
          >
            <CoinIcon size={18} />
            <span
              key={balance}
              className="display rr-pop"
              style={{ fontSize: 18, color: "var(--amber)" }}
            >
              {balance}
            </span>
          </div>
          {/* Gem pill: cyan/violet ring + glow mirroring the coin pill's gold treatment. */}
          <div
            aria-label={fmt(t.vault.gemBalance, { n: gemsBalance })}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              padding: "9px 13px",
              minHeight: 44,
              borderRadius: 999,
              background: "var(--panel)",
              border: "1px solid color-mix(in srgb, var(--cyan) 55%, transparent)",
              boxShadow:
                "0 0 18px color-mix(in srgb, var(--cyan) 22%, transparent), inset 0 1px 0 rgba(255,255,255,.07)",
            }}
          >
            <GemIcon size={18} />
            <span
              key={gemsBalance}
              className="display rr-pop"
              style={{ fontSize: 18, color: "var(--cyan)" }}
            >
              {gemsBalance}
            </span>
          </div>
        </div>
      </header>

      <div style={{ position: "relative", marginTop: 14, marginBottom: 4 }}>
        {/* Idle sparkles around the wordmark (decorative; collapse under reduced motion). */}
        <span
          aria-hidden
          className="rr-twinkle"
          style={{
            position: "absolute",
            top: -6,
            right: 26,
            color: "var(--amber)",
            fontSize: 13,
            textShadow: "0 0 8px rgba(255,201,30,.8)",
          }}
        >
          ✦
        </span>
        <span
          aria-hidden
          className="rr-twinkle"
          style={{
            position: "absolute",
            top: 22,
            right: 64,
            color: "var(--brand-2)",
            fontSize: 10,
            animationDelay: ".9s",
          }}
        >
          ✦
        </span>
        <Display pop gold style={{ fontSize: 32 }}>
          {t.vault.title}
        </Display>
        <div
          style={{ color: "var(--muted)", fontWeight: 800, fontSize: 12, letterSpacing: 1, marginTop: 4 }}
        >
          {t.vault.subtitle}
        </div>
      </div>

      {/* Themes | Frames segmented control — same pattern as LeaderboardTabs. */}
      <div
        role="tablist"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: 4,
          marginTop: 18,
          borderRadius: 999,
          background: "color-mix(in srgb, var(--panel) 60%, transparent)",
          border: "1px solid var(--line)",
        }}
      >
        <VaultTabButton
          label={t.vault.tabThemes}
          active={tab === "themes"}
          onClick={() => setTab("themes")}
        />
        <VaultTabButton
          label={t.vault.tabFrames}
          active={tab === "frames"}
          onClick={() => setTab("frames")}
        />
      </div>

      <section style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 14 }}>
        {visible === null ? (
          // Skeleton of the catalog shape (tier header + cards) while the vault loads.
          <div aria-busy aria-label={t.common.loading} style={{ display: "grid", gap: 14 }}>
            <Skeleton width={140} height={14} />
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={132} radius={18} />
            ))}
          </div>
        ) : (
          // Group into ordered rarity tiers (common → rare → prestige) so the shop reads as a
          // tiered catalog. The Card + buy/equip wiring is untouched — only the layout groups.
          groupByRarity(visible).map(({ rarity, items: tierItems }) => {
            const isFrames = tab === "frames";
            const Card = isFrames ? FrameCard : VaultItemCard;
            return (
              <div
                key={rarity}
                style={{ display: "flex", flexDirection: "column", gap: 14 }}
              >
                <RaritySectionHeader rarity={rarity} count={tierItems.length} />
                {/* Frames are compact — 2 per row; themes stay full-width (they carry the live
                    preview). */}
                <div
                  style={
                    isFrames
                      ? { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "start" }
                      : { display: "flex", flexDirection: "column", gap: 14 }
                  }
                >
                  {tierItems.map((item) => (
                    <Card
                      key={item.id}
                      item={item}
                      // Each card sees ITS currency's wallet, so affordability/shortfall work against
                      // the right balance (a Gem frame is gated by Gems, never coins).
                      balance={item.currency === "gems" ? gemsBalance : balance}
                      busy={busy}
                      spotlight={item.id === spotlightId}
                      justUnlocked={item.id === justUnlocked}
                      onBuy={() => setConfirming(item)}
                      onEquip={() => void equip(item)}
                    />
                  ))}
                </div>
              </div>
            );
          })
        )}
      </section>

      <p style={{ marginTop: 16, fontSize: 12, color: "var(--faint)", textAlign: "center" }}>
        {t.vault.cosmeticNote}
      </p>

      {confirming && (
        <ConfirmSheet
          item={confirming}
          busy={busy}
          onConfirm={() => void buy(confirming)}
          onCancel={() => setConfirming(null)}
        />
      )}
    </main>
  );
}

/**
 * Tier divider for a rarity section — a tinted label flanked by a hairline rule so the catalog
 * reads as grouped tiers, not one long list. The accent + label come from RARITY_META (the same
 * source the card chips use), so a tier's color is consistent everywhere. Decorative chrome only.
 */
function RaritySectionHeader({
  rarity,
  count,
}: {
  rarity: Rarity;
  count: number;
}) {
  const t = useT();
  const meta = RARITY_META[rarity];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "2px 2px 0" }}>
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: meta.accent,
          boxShadow: `0 0 8px ${meta.accent}`,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontWeight: 900,
          fontSize: 12,
          letterSpacing: 1.4,
          textTransform: "uppercase",
          color: meta.accent,
          whiteSpace: "nowrap",
        }}
      >
        {t.vault.rarity[meta.labelKey]}
      </span>
      <span
        aria-hidden
        style={{
          flex: 1,
          height: 1,
          background: `linear-gradient(90deg, ${meta.accent}55, transparent)`,
        }}
      />
      <span style={{ color: "var(--faint)", fontWeight: 800, fontSize: 11 }}>{count}</span>
    </div>
  );
}

/** Pill tab button — mirrors LeaderboardTabs' TabButton so the two controls feel identical. */
function VaultTabButton({
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
        flex: 1,
        padding: "8px 14px",
        borderRadius: 999,
        border: "none",
        cursor: active ? "default" : "pointer",
        fontFamily: "Fredoka, sans-serif",
        fontWeight: 800,
        fontSize: 13,
        letterSpacing: "0.04em",
        transition: "background 180ms, color 180ms, box-shadow 180ms",
        background: active
          ? "linear-gradient(135deg, var(--brand), color-mix(in srgb, var(--brand) 70%, black))"
          : "transparent",
        color: active ? "var(--text)" : "var(--muted)",
        boxShadow: active
          ? "0 0 14px color-mix(in srgb, var(--brand) 35%, transparent), inset 0 1px 0 rgba(255,255,255,.08)"
          : "none",
      }}
    >
      <FitText
        as="span"
        size={13}
        min={0.66}
        style={{ display: "block", width: "100%", whiteSpace: "nowrap", overflow: "hidden", textAlign: "center" }}
      >
        {label}
      </FitText>
    </button>
  );
}

/**
 * Chest-opening confirm: springy bottom-sheet entrance (rr-sheet-in), the item's live preview
 * inside, and a glowing GoldButton confirm. Kind-aware: themes show their ThemePreview; frames
 * show the player's own avatar wearing the frame (same personal preview as FrameCard). Same flow
 * contract as before — confirm disables while busy (double-submit guard) and the parent owns the
 * buy call.
 */
function ConfirmSheet({
  item,
  busy,
  onConfirm,
  onCancel,
}: {
  item: VaultItem;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const preset = useSessionStore((s) => s.me?.avatar_preset);
  const isFrame = item.kind === "frame";
  const isGem = item.currency === "gems";
  const name = isFrame ? (getFrame(item.id)?.name ?? item.id) : getTheme(item.id).name;

  return (
    <>
      {/* Dim overlay — same pattern as ProfileMenu */}
      <button
        type="button"
        aria-label={t.vault.cancel}
        onClick={onCancel}
        className="rr-scrim"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 60,
          border: "none",
          background: "rgba(8,4,20,.6)",
          cursor: "default",
          animation: "rr-fade-in .25s ease",
        }}
      />
      {/* Panel */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 70,
          padding: "0 16px calc(32px + env(safe-area-inset-bottom))",
        }}
      >
        <div
          className="rr-sheet-in rr-menu"
          style={{
            maxWidth: 480,
            margin: "0 auto",
            display: "flex",
            flexDirection: "column",
            gap: 14,
            padding: "24px 20px",
            borderRadius: 22,
            background: "linear-gradient(180deg, var(--panel2), var(--panel))",
            border: "1px solid rgba(255,201,30,.45)",
            boxShadow:
              "0 24px 50px rgba(0,0,0,.6), 0 0 30px rgba(255,201,30,.12), inset 0 1px 0 rgba(255,255,255,.07)",
          }}
        >
          {isFrame ? (
            <div
              aria-hidden
              style={{
                display: "grid",
                placeItems: "center",
                height: 128,
                borderRadius: 14,
                border: "1px solid var(--line)",
                background:
                  "radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--brand) 16%, transparent), transparent 70%)",
              }}
            >
              <Avatar size={80} preset={preset} frame={item.id} art={lobbyArt.avatarHooded} />
            </div>
          ) : (
            <ThemePreview theme={getTheme(item.id)} height={88} />
          )}
          <div style={{ fontWeight: 900, fontSize: 18, color: "var(--text)" }}>
            {fmt(t.vault.confirmTitle, { name })}
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--muted)",
              lineHeight: 1.5,
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            {/* Currency-matched cost mark sits beside the body copy: Gem frames read in Gems. */}
            {isGem ? <GemIcon size={15} /> : <CoinIcon size={15} />}
            <span>
              {fmt(
                isGem
                  ? t.vault.confirmBodyGem
                  : isFrame
                    ? t.vault.confirmBodyFrame
                    : t.vault.confirmBody,
                { cost: item.cost },
              )}
            </span>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              onClick={onCancel}
              style={{
                flex: 1,
                minHeight: 48,
                padding: "12px 16px",
                borderRadius: 14,
                border: "1px solid var(--line)",
                background: "transparent",
                color: "var(--muted)",
                fontWeight: 800,
                fontSize: 14,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {t.vault.cancel}
            </button>
            <GoldButton
              disabled={busy}
              onClick={onConfirm}
              style={{ flex: 2, width: "auto", fontSize: 17, padding: "12px 18px" }}
            >
              {busy ? "…" : t.vault.confirmUnlock}
            </GoldButton>
          </div>
        </div>
      </div>
    </>
  );
}
