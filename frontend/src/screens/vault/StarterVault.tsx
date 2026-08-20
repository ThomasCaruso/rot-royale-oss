import { useState } from "react";
import type { CSSProperties } from "react";
import type { VaultItem } from "@/api/client";
import { fmt, useT } from "@/i18n/useT";
import { getTheme, THEMES, type Theme } from "@/theme/tokens";
import { getFrame } from "@/theme/identity";
import { Avatar } from "@/screens/home/Avatar";
import { CoinIcon } from "@/ui/CoinIcon";
import { CrownIcon } from "@/ui/CrownIcon";
import { GemIcon } from "@/ui/GemIcon";
import { ThemeShot } from "@/screens/vault/ThemeShot";
import { requirementCopy } from "@/screens/vault/requirementCopy";
import { FitText } from "@/ui/FitText";
import { Skeleton } from "@/ui/Skeleton";

/**
 * The Starter-system Vault — a curated cosmetics boutique rather than a settings list.
 *
 * Reading order, top to bottom: utility row (back + both wallets) → header block → segmented
 * control → ONE large featured card for what you currently wear → the "All …" product row →
 * an informational strip. Purely presentational: every price, ownership and lock state is passed
 * in from VaultScreen, which owns the server plumbing.
 *
 * PRICES ARE REAL. The catalog is the server's (`cosmetics.py`) — themes are bought with COINS,
 * frames may be Gems, and several themes are EARNED (cost 0 + a requirement) rather than sold. A
 * card shows the wallet its own `currency` names and the goal copy for a locked one; nothing here
 * invents an item or a price (DESIGN §7).
 */
export function StarterVault({
  tab,
  onTab,
  onBack,
  items,
  balance,
  gemsBalance,
  equippedFrameId,
  avatarPreset,
  busy,
  onBuy,
  onEquip,
}: {
  tab: "themes" | "frames";
  onTab: (t: "themes" | "frames") => void;
  onBack: () => void;
  items: VaultItem[] | null;
  balance: number;
  gemsBalance: number;
  equippedFrameId: string | null;
  avatarPreset: string | undefined;
  busy: boolean;
  onBuy: (item: VaultItem) => void;
  onEquip: (item: VaultItem) => void;
}) {
  const t = useT();
  const [showDetails, setShowDetails] = useState(false);

  const visible = items?.filter((i) => (tab === "frames" ? i.kind === "frame" : i.kind === "theme")) ?? null;
  const featured = visible?.find((i) => i.equipped) ?? null;
  const rest = visible?.filter((i) => !i.equipped) ?? [];
  // Unreleased items are held back BY THE SERVER (`coming_soon` on the catalog item, which also
  // makes buy refuse). This only decides where they sit on screen.
  const available = rest.filter((i) => !i.coming_soon);
  const soon = rest.filter((i) => i.coming_soon);

  return (
    <main style={shell}>
      <UtilityRow onBack={onBack} balance={balance} gems={gemsBalance} backLabel={t.vault.back} />

      <header style={{ marginTop: 18 }}>
        {/* Dramatic serif title — a longer localized word shrinks to hold one line (FitText) rather
            than wrapping and shoving the boutique down. */}
        <FitText
          as="div"
          className="display"
          size="clamp(34px, 10vw, 44px)"
          min={0.6}
          style={{
            lineHeight: 1.0,
            letterSpacing: "0.01em",
            color: INK.text,
            // The display face puts descenders below the content box; pad the clip box and cancel the shift.
            paddingBottom: "0.12em",
            marginBottom: "-0.12em",
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          {t.vault.title}
        </FitText>
        <div style={subtitleStyle}>{t.vault.subtitle}</div>
      </header>

      <Segmented tab={tab} onTab={onTab} labels={{ themes: t.vault.tabThemes, frames: t.vault.tabFrames }} />

      {featured && (
        <FeaturedCard
          item={featured}
          tab={tab}
          equippedFrameId={equippedFrameId}
          avatarPreset={avatarPreset}
          open={showDetails}
          onToggle={() => setShowDetails((s) => !s)}
        />
      )}

      <SectionLabel text={tab === "frames" ? t.vault.allFrames : t.vault.allThemes} />

      {items === null && (
        // Catalog still loading: a skeleton shelf holds the layout instead of an empty page.
        <div aria-busy aria-label={t.common.loading} style={productRow}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={190} radius={16} />
          ))}
        </div>
      )}

      <div style={productRow}>
        {available.map((item) => (
          <ProductCard
            key={item.id}
            item={item}
            tab={tab}
            balance={balance}
            gemsBalance={gemsBalance}
            avatarPreset={avatarPreset}
            busy={busy}
            onBuy={onBuy}
            onEquip={onEquip}
          />
        ))}
      </div>

      {soon.length > 0 && (
        <>
          <SoonDivider />
          <div style={productRow}>
            {soon.map((item) => (
              <ProductCard
                key={item.id}
                item={item}
                tab={tab}
                balance={balance}
                gemsBalance={gemsBalance}
                avatarPreset={avatarPreset}
                busy={busy}
                onBuy={onBuy}
                onEquip={onEquip}
              />
            ))}
          </div>
        </>
      )}

      <ComingSoonStrip />
    </main>
  );
}

/* ---------------- top utility row ---------------- */

function UtilityRow({
  onBack,
  balance,
  gems,
  backLabel,
}: {
  onBack: () => void;
  balance: number;
  gems: number;
  backLabel: string;
}) {
  const t = useT();
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      <button type="button" onClick={onBack} aria-label={backLabel} style={backBtn}>
        <span aria-hidden style={{ fontSize: 16, lineHeight: 1 }}>
          ←
        </span>
        {backLabel}
      </button>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Wallet
          label={fmt(t.vault.balance, { n: balance })}
          icon={<CoinIcon size={16} />}
          value={balance}
          accent="var(--amber)"
        />
        <Wallet
          label={fmt(t.vault.gemBalance, { n: gems })}
          icon={<GemIcon size={16} />}
          value={gems}
          accent="var(--brand)"
        />
      </div>
    </div>
  );
}

/** A wallet pill. Soft and rounded rather than ringed/glowing — the boutique reads calm, and the
 *  accent lives in the numeral, not in a halo around the pill. */
function Wallet({
  label,
  icon,
  value,
  accent,
}: {
  label: string;
  icon: React.ReactNode;
  value: number;
  accent: string;
}) {
  return (
    <div
      aria-label={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        minHeight: 40,
        padding: "8px 14px",
        borderRadius: 999,
        background: IVORY_CARD,
        border: FINE_BORDER,
        boxShadow: SHADOW_SOFT,
      }}
    >
      {icon}
      <span key={value} className="rr-pop" style={{ ...NUM, fontSize: 15, fontWeight: 800, color: accent }}>
        {value.toLocaleString()}
      </span>
    </div>
  );
}

/* ---------------- segmented control ---------------- */

/** One large pill spanning the width: an ivory trough with a royal-purple thumb. Deliberately
 *  substantial (48px) so it reads as a designed selector, not a default tab bar. */
function Segmented({
  tab,
  onTab,
  labels,
}: {
  tab: "themes" | "frames";
  onTab: (t: "themes" | "frames") => void;
  labels: { themes: string; frames: string };
}) {
  return (
    <div role="tablist" style={segTrough}>
      {(["themes", "frames"] as const).map((key) => {
        const on = tab === key;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onTab(key)}
            style={{
              flex: 1,
              minHeight: 44,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              border: "none",
              cursor: "pointer",
              borderRadius: 999,
              fontFamily: NAME_FONT,
              fontSize: 14.5,
              fontWeight: 800,
              letterSpacing: "0.01em",
              background: on ? "var(--cta)" : "transparent",
              color: on ? "var(--ctaText)" : INK.muted,
              boxShadow: on ? "0 6px 16px color-mix(in srgb, var(--brand) 30%, transparent)" : "none",
            }}
          >
            {on && <CrownIcon size={15} />}
            {labels[key]}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- featured (equipped) card ---------------- */

/** The centrepiece: what you are wearing right now, given a whole card. Split left/right — the
 *  identity and its status on the left, a live preview on the right. The preview is rendered from
 *  the theme's REAL `vars` (or the player's own avatar wearing the frame), never a static
 *  thumbnail, so it always shows what is actually equipped. */
function FeaturedCard({
  item,
  tab,
  equippedFrameId,
  avatarPreset,
  open,
  onToggle,
}: {
  item: VaultItem;
  tab: "themes" | "frames";
  equippedFrameId: string | null;
  avatarPreset: string | undefined;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const theme = tab === "themes" ? getTheme(item.id) : null;
  const frame = tab === "frames" ? getFrame(item.id) : null;
  const name = theme?.name ?? frame?.name ?? item.id;
  const blurb = theme?.blurb ?? frame?.blurb ?? "";

  return (
    <section style={featuredCard}>
      <div style={{ display: "flex", gap: 16, alignItems: "stretch" }}>
        <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: 9 }}>
          <div style={eyebrow}>{tab === "frames" ? t.vault.equippedFrame : t.vault.equippedTheme}</div>
          <div style={{ fontFamily: NAME_FONT, fontSize: 22, fontWeight: 800, color: INK.text, lineHeight: 1.1 }}>
            {name}
          </div>
          <span style={equippedPill}>{t.vault.equipped}</span>
          <div style={{ fontSize: 12.5, lineHeight: 1.55, color: INK.muted }}>{blurb}</div>
          <button type="button" onClick={onToggle} aria-expanded={open} style={ghostBtn}>
            {open ? t.vault.hideDetails : t.vault.viewDetails}
          </button>
        </div>

        <div style={{ flex: "none", width: "46%", maxWidth: 176, display: "flex", alignItems: "center" }}>
          {theme ? (
            <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
              <ThemeShot theme={theme} width={112} />
            </div>
          ) : (
            <div style={framePreviewPanel}>
              <Avatar size={72} preset={avatarPreset} frame={equippedFrameId} animated={false} />
            </div>
          )}
        </div>
      </div>

      {open && theme && <ThemeDetails theme={theme} />}
    </section>
  );
}

/** The "View details" disclosure — real data only: the theme's shape family and the actual palette
 *  it paints the app with, read straight off its `vars`. */
function ThemeDetails({ theme }: { theme: Theme }) {
  const t = useT();
  const swatches: [string, string][] = [
    ["--brand", theme.vars["--brand"]],
    ["--amber", theme.vars["--amber"]],
    ["--panel", theme.vars["--panel"]],
    ["--text", theme.vars["--text"]],
  ].filter((s): s is [string, string] => Boolean(s[1]));

  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: FINE_BORDER, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ ...eyebrow, margin: 0 }}>{t.vault.styleLabel}</span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: INK.text }}>{theme.style}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ ...eyebrow, margin: 0 }}>{t.vault.paletteLabel}</span>
        <span style={{ display: "inline-flex", gap: 6 }}>
          {swatches.map(([key, value]) => (
            <span
              key={key}
              aria-hidden
              style={{
                width: 20,
                height: 20,
                borderRadius: 7,
                background: value,
                border: FINE_BORDER,
                boxShadow: "inset 0 1px 0 rgba(255,255,255,.35)",
              }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}

/* ---------------- the product row ---------------- */

function SectionLabel({ text }: { text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 26, marginBottom: 12 }}>
      <SparkleGlyph />
      <span style={{ ...eyebrow, margin: 0, fontSize: 11 }}>{text}</span>
    </div>
  );
}

/** A hairline rule with the label sitting in it — the whole announcement is one quiet line. No
 *  badge, no banner, no colour: these are not for sale yet, and that should read as a gentle full
 *  stop rather than a promotion. */
function SoonDivider() {
  const t = useT();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 26, marginBottom: 14 }}>
      <span aria-hidden style={rule} />
      <FitText as="span" size={10} min={0.66} style={{ fontFamily: NAME_FONT, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: INK.faint, margin: 0, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden" }}>{t.vault.comingSoonDivider}</FitText>
      <span aria-hidden style={rule} />
    </div>
  );
}

function SparkleGlyph() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" style={{ width: 13, height: 13, display: "block" }} fill="var(--amber)">
      <path d="M12 2l2.2 6.4L20.6 10l-6.4 2.2L12 18.6 9.8 12.2 3.4 10l6.4-1.6z" />
    </svg>
  );
}

/** One collectible tile: preview on top, name, then its real status — a price in ITS wallet, the
 *  goal copy for something earned, or Equip for what you already own. */
function ProductCard({
  item,
  tab,
  balance,
  gemsBalance,
  avatarPreset,
  busy,
  onBuy,
  onEquip,
}: {
  item: VaultItem;
  tab: "themes" | "frames";
  balance: number;
  gemsBalance: number;
  avatarPreset: string | undefined;
  busy: boolean;
  onBuy: (i: VaultItem) => void;
  onEquip: (i: VaultItem) => void;
}) {
  const t = useT();
  const theme = tab === "themes" ? THEMES.find((th) => th.id === item.id) ?? null : null;
  const frame = tab === "frames" ? getFrame(item.id) : null;
  const name = theme?.name ?? frame?.name ?? item.id;
  const gems = item.currency === "gems";
  const wallet = gems ? gemsBalance : balance;
  const affordable = wallet >= item.cost;
  const goal = requirementCopy(item.requirement, t);

  return (
    <div style={productCard}>
      <div
        style={{
          position: "relative",
          display: "flex",
          justifyContent: "center",
          paddingTop: 4,
          // Not yet available: shown, but visibly held back rather than dressed up.
          opacity: item.coming_soon ? 0.55 : 1,
          filter: item.coming_soon ? "saturate(0.7)" : undefined,
        }}
      >
        {theme ? (
          <ThemeShot theme={theme} width={96} />
        ) : (
          <div style={{ ...framePreviewPanel, height: 112, borderRadius: 0, border: "none" }}>
            <Avatar size={52} preset={avatarPreset} frame={item.id} animated={false} />
          </div>
        )}
        {/* `locked` (requirement unmet) and `owned` are independent: an earned item can be granted
            or acknowledged while its requirement still reads as unmet, and then a LOCKED badge on
            something with an Equip button underneath is simply wrong. Ownership wins. */}
        {item.locked && !item.owned && <span style={cornerBadge}>{t.vault.lockedLabel}</span>}
      </div>

      <div style={{ fontFamily: NAME_FONT, fontSize: 13.5, fontWeight: 800, color: INK.text, marginTop: 9 }}>
        {name}
      </div>

      <div style={{ marginTop: 4, minHeight: 32 }}>
        {/* OWNERSHIP OUTRANKS RELEASE STATE. `coming_soon` withholds an item from SALE — the server
            refuses to sell it and grants no implicit ownership — but it says nothing about someone
            who already holds an explicit grant. Checking it first hid the Equip button from the one
            account that legitimately has these, which is backwards: if you own it, you can wear it.
            Deliberately keyed on ownership rather than on a username, so nothing is special-cased
            and a future beta grant behaves the same. */}
        {item.owned ? (
          <button type="button" disabled={busy} onClick={() => onEquip(item)} style={equipBtn}>
            {t.vault.equip}
          </button>
        ) : item.coming_soon ? (
          <div style={{ fontSize: 11, fontWeight: 700, color: INK.faint }}>
            {t.vault.comingSoonDivider}
          </div>
        ) : item.locked ? (
          <div style={{ fontSize: 11, lineHeight: 1.4, color: INK.faint }}>{goal ?? t.vault.lockedLabel}</div>
        ) : (
          <button
            type="button"
            disabled={busy || !affordable}
            onClick={() => onBuy(item)}
            style={{ ...priceBtn, opacity: affordable ? 1 : 0.55 }}
          >
            {gems ? <GemIcon size={13} /> : <CoinIcon size={13} />}
            <span style={{ ...NUM, fontWeight: 800 }}>{item.cost.toLocaleString()}</span>
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------------- informational strip ---------------- */

/** Calm and informative, not an ad. NOTE: the target's "Follow updates" button is deliberately
 *  absent — there is no updates feed, subscription or announcement channel behind it, and a control
 *  that does nothing is worse than none. Wire it here the moment there is something real to follow. */
function ComingSoonStrip() {
  const t = useT();
  return (
    <div style={promoStrip}>
      <span aria-hidden style={promoIcon}>
        <CrownIcon size={19} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: NAME_FONT, fontSize: 13.5, fontWeight: 800, color: INK.text }}>
          {t.vault.comingSoonTitle}
        </div>
        <div style={{ fontSize: 12, color: INK.muted, marginTop: 2 }}>{t.vault.comingSoonBody}</div>
      </div>
    </div>
  );
}

/* ---------------- surface language ---------------- */

const NAME_FONT = "'Sora', system-ui, sans-serif";
const NUM: CSSProperties = { fontFamily: NAME_FONT, fontVariantNumeric: "tabular-nums" };

/** Ink read off the Starter palette. Kept as tokens (not literals like the hero plate's PLATE_INK)
 *  because this screen's surfaces ARE the themed panel — it reskins correctly with the theme. */
const INK = {
  text: "var(--text)",
  muted: "var(--muted)",
  faint: "var(--faint)",
} as const;

const FINE_BORDER = "1px solid rgba(112,96,150,.12)";
const SHADOW_SOFT = "0 1px 1px rgba(58,44,92,.03), 0 6px 16px rgba(58,44,92,.05)";
const IVORY_CARD = "linear-gradient(180deg, var(--panel) 0%, color-mix(in srgb, var(--panel) 94%, var(--bg)) 100%)";

const shell: CSSProperties = {
  position: "relative",
  minHeight: "100dvh",
  maxWidth: 480,
  margin: "0 auto",
  padding:
    "calc(16px + env(safe-area-inset-top)) clamp(14px, 4vw, 18px) calc(124px + env(safe-area-inset-bottom))",
};

const backBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  minHeight: 40,
  padding: "0 6px 0 0",
  border: "none",
  background: "transparent",
  color: INK.muted,
  fontFamily: NAME_FONT,
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
};

const subtitleStyle: CSSProperties = {
  marginTop: 7,
  fontFamily: NAME_FONT,
  fontSize: 11.5,
  fontWeight: 700,
  letterSpacing: "0.09em",
  textTransform: "uppercase",
  color: INK.faint,
};

const segTrough: CSSProperties = {
  display: "flex",
  gap: 4,
  marginTop: 22,
  padding: 4,
  borderRadius: 999,
  background: IVORY_CARD,
  border: FINE_BORDER,
  boxShadow: SHADOW_SOFT,
};

const featuredCard: CSSProperties = {
  marginTop: 20,
  padding: 18,
  borderRadius: 24,
  background: IVORY_CARD,
  // The one gold outline on the screen — it marks the equipped piece and nothing else.
  border: "1px solid color-mix(in srgb, var(--amber) 42%, transparent)",
  boxShadow: "0 1px 1px rgba(58,44,92,.03), 0 10px 26px rgba(58,44,92,.07)",
};

const eyebrow: CSSProperties = {
  fontFamily: NAME_FONT,
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: INK.faint,
};

const equippedPill: CSSProperties = {
  alignSelf: "flex-start",
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 11px",
  borderRadius: 999,
  fontFamily: NAME_FONT,
  fontSize: 11,
  fontWeight: 800,
  // A readable green on the ivory card — `--lime` itself is tuned for dark surfaces and washes out.
  color: "color-mix(in srgb, var(--lime) 72%, var(--text))",
  background: "color-mix(in srgb, var(--lime) 16%, transparent)",
  border: "1px solid color-mix(in srgb, var(--lime) 38%, transparent)",
};

const ghostBtn: CSSProperties = {
  alignSelf: "flex-start",
  marginTop: 2,
  minHeight: 36,
  padding: "0 14px",
  borderRadius: 12,
  border: FINE_BORDER,
  background: "color-mix(in srgb, var(--brand) 6%, transparent)",
  color: "var(--brand)",
  fontFamily: NAME_FONT,
  fontSize: 12.5,
  fontWeight: 800,
  cursor: "pointer",
};

const framePreviewPanel: CSSProperties = {
  width: "100%",
  height: 124,
  borderRadius: 16,
  border: FINE_BORDER,
  background: "color-mix(in srgb, var(--brand) 5%, transparent)",
  display: "grid",
  placeItems: "center",
};

/** Two per row, scrolling with the PAGE. A sideways shelf hid most of the catalog behind a gesture
 *  and made the previews too small to judge; a two-up grid keeps every theme reachable by the same
 *  vertical scroll as the rest of the screen, and buys each tile enough width for a legible preview. */
const productRow: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 12,
};

const productCard: CSSProperties = {
  minWidth: 0,
  padding: 10,
  borderRadius: 18,
  background: IVORY_CARD,
  border: FINE_BORDER,
  boxShadow: SHADOW_SOFT,
};

const cornerBadge: CSSProperties = {
  position: "absolute",
  top: 7,
  right: 7,
  padding: "3px 8px",
  borderRadius: 999,
  fontFamily: NAME_FONT,
  fontSize: 9.5,
  fontWeight: 800,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--panel)",
  background: "color-mix(in srgb, var(--text) 62%, transparent)",
};

const equipBtn: CSSProperties = {
  width: "100%",
  minHeight: 32,
  borderRadius: 10,
  border: "none",
  background: "var(--cta)",
  color: "var(--ctaText)",
  fontFamily: NAME_FONT,
  fontSize: 12,
  fontWeight: 800,
  cursor: "pointer",
};

const priceBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  minHeight: 32,
  padding: "0 12px",
  borderRadius: 10,
  border: FINE_BORDER,
  background: "color-mix(in srgb, var(--amber) 12%, transparent)",
  color: INK.text,
  fontFamily: NAME_FONT,
  fontSize: 12.5,
  cursor: "pointer",
};

const rule: CSSProperties = {
  flex: 1,
  height: 1,
  background: "color-mix(in srgb, var(--text) 12%, transparent)",
};

const promoStrip: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  marginTop: 22,
  padding: "14px 16px",
  borderRadius: 20,
  background: IVORY_CARD,
  border: FINE_BORDER,
  boxShadow: SHADOW_SOFT,
};

const promoIcon: CSSProperties = {
  flex: "none",
  width: 40,
  height: 40,
  borderRadius: "50%",
  display: "grid",
  placeItems: "center",
  background: "color-mix(in srgb, var(--amber) 14%, transparent)",
  border: "1px solid color-mix(in srgb, var(--amber) 30%, transparent)",
};
