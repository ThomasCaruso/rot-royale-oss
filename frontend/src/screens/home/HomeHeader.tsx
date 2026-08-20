import { lobbyArt } from "@/assets/lobby";
import { useT } from "@/i18n/useT";
import { FitText } from "@/ui/FitText";
import { Avatar } from "@/screens/home/Avatar";
import { useArtStyle, useThemeArt } from "@/theme/useArtStyle";
import { activeTag } from "@/i18n/format";

/**
 * Branded Home header (mock layout): the skull-with-crown mark + stacked ROT / ROYALE wordmark on the
 * left; a gold coins pill + the player's avatar (opens the profile menu) on the right. The coins pill
 * opens the Vault, the one place coins are spent (coins are an earned-only cosmetic currency, never
 * purchasable) — at a ZERO balance its affordance is an "EARN ›" tag, never a bare "+" (a plus beside
 * a 0 reads as a buy-coins prompt, exactly the casino signal this app must not send). The avatar chip
 * renders the illustrated player portrait (the same art family as the Battle "You" portrait) over the
 * identity preset's disc, wearing the equipped frame — the emoji face stays the identity everywhere
 * else (menu, leaderboard, editor). The gem balance lives on the Battle/Duel surfaces, not the header.
 */
export function HomeHeader({
  coins,
  avatarPreset,
  equippedFrame,
  onOpenMenu,
  onOpenVault,
}: {
  coins: number;
  avatarPreset?: string;
  equippedFrame?: string | null;
  onOpenMenu: () => void;
  onOpenVault: () => void;
}) {
  const t = useT();
  const mono = useArtStyle() === "mono";
  const art = useThemeArt();
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
      }}
    >
      {/* Left: the brand lockup. Premium (Starter system) pairs a small serif-R crest with the
          wordmark — a proper brand mark, per the reference; the art-less Blank pair keeps its
          pure-type wordmark; every other style keeps the illustrated ROT ROYALE banner
          (shield-R-crown + wordmark in one asset). Height-driven so it scales cleanly; maxWidth
          caps it so it never crowds the coins pill + avatar on narrow screens. */}
      {mono && art ? (
        /* Premium (Starter system): the brand LOCKUP — the gold crown-shield "R" crest beside the
           serif wordmark. A real mark that SUPPORTS the wordmark (it never dominates): the crest is
           height-capped at ~46px, the type sits in the Starter display face. Its gold and violet
           are exactly the Starter accent story, so it sits naturally on the ivory header. */
        <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: "0 1 auto" }}>
          <img
            src={art.logo}
            alt=""
            aria-hidden
            draggable={false}
            style={{
              height: "clamp(36px, 9.6vw, 42px)",
              width: "auto",
              objectFit: "contain",
              display: "block",
              flex: "none",
              filter: "drop-shadow(0 3px 7px color-mix(in srgb, var(--brand) 24%, transparent))",
            }}
          />
          <span
            className="display"
            style={{
              fontSize: "clamp(21px, 5.8vw, 25px)",
              lineHeight: 1,
              color: "var(--text)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              minWidth: 0,
            }}
          >
            Rot Royale
          </span>
        </span>
      ) : mono ? (
        <span
          className="display"
          style={{ fontSize: "clamp(19px, 5.4vw, 23px)", lineHeight: 1, whiteSpace: "nowrap", flex: "0 1 auto", minWidth: 0 }}
        >
          Rot Royale
        </span>
      ) : (
        <img
          src={lobbyArt.rotRoyaleBanner}
          alt="Rot Royale"
          draggable={false}
          style={{
            height: "clamp(30px, 8.6vw, 44px)",
            width: "auto",
            maxWidth: "54vw",
            objectFit: "contain",
            objectPosition: "left center",
            display: "block",
            flex: "0 1 auto",
            minWidth: 0,
            filter: "drop-shadow(0 3px 6px rgba(0,0,0,.5))",
          }}
        />
      )}

      {/* Right: coins pill (+ add) and avatar. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
        <button
          type="button"
          className="rr-tap"
          aria-label={t.vault.openVault}
          onClick={onOpenVault}
          style={
            mono && art
              ? {
                  // Premium (Starter system): a quiet hairline pill sized as a utility control —
                  // snug padding (no dead space around the balance) with the cards' top-edge light.
                  display: "flex",
                  alignItems: "center",
                  gap: "clamp(5px, 1.6vw, 7px)",
                  padding: "7px 9px 7px clamp(9px, 2.6vw, 12px)",
                  borderRadius: 999,
                  background: "var(--panel)",
                  border: "1px solid var(--line)",
                  boxShadow: "inset 0 1px 0 var(--sheen), 0 2px 6px color-mix(in srgb, var(--brand) 8%, transparent)",
                  cursor: "pointer",
                }
              : mono
              ? {
                  // Mono: a quiet hairline pill — no gradient chrome, no glow.
                  display: "flex",
                  alignItems: "center",
                  gap: "clamp(5px, 1.8vw, 8px)",
                  padding: "6px 8px 6px clamp(8px, 2.6vw, 11px)",
                  borderRadius: 999,
                  background: "var(--panel)",
                  border: "1px solid var(--line)",
                  cursor: "pointer",
                }
              : {
                  display: "flex",
                  alignItems: "center",
                  gap: "clamp(5px, 1.8vw, 8px)",
                  padding: "6px 6px 6px clamp(8px, 2.6vw, 11px)",
                  borderRadius: 999,
                  background: "linear-gradient(180deg, color-mix(in srgb, var(--brand) 20%, rgba(14,8,30,.92)), rgba(8,4,20,.92))",
                  border: "1px solid color-mix(in srgb, var(--amber) 50%, transparent)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,.12), 0 6px 16px rgba(0,0,0,.4), 0 0 10px color-mix(in srgb, var(--amber) 10%, transparent)",
                  cursor: "pointer",
                }
          }
        >
          {mono && art ? (
            /* Premium coin mark: a small polished gold disc with an inner ring — reads as real
               currency on the ivory pill (still pure CSS, no bitmap). */
            <span
              aria-hidden
              style={{
                width: 21,
                height: 21,
                borderRadius: "50%",
                flex: "none",
                background:
                  "radial-gradient(120% 120% at 35% 28%, color-mix(in srgb, var(--amber) 55%, white), var(--amber))",
                border: "1px solid color-mix(in srgb, var(--amber) 78%, #6b4c0c)",
                boxShadow: "inset 0 0 0 2.5px color-mix(in srgb, var(--amber) 55%, white), inset 0 1px 0 rgba(255,255,255,.6)",
              }}
            />
          ) : mono ? (
            /* Pure-CSS coin mark: a thin ring — currency as line-art, no bitmap. */
            <span
              aria-hidden
              style={{
                width: 18,
                height: 18,
                borderRadius: "50%",
                border: "2px solid var(--text)",
                display: "block",
                flex: "none",
              }}
            />
          ) : (
            <img
              src={lobbyArt.coin}
              alt=""
              aria-hidden
              draggable={false}
              style={{ width: "clamp(22px, 7vw, 28px)", height: "clamp(22px, 7vw, 28px)", objectFit: "contain", display: "block", filter: "drop-shadow(0 2px 4px rgba(0,0,0,.5))" }}
            />
          )}
          <span className="display" style={{ fontSize: "clamp(15px, 4.8vw, 19px)", color: "var(--amber)", lineHeight: 1, textShadow: "0 1px 6px color-mix(in srgb, var(--amber) 40%, transparent)" }}>
            {coins.toLocaleString(activeTag())}
          </span>
          {coins === 0 ? (
            /* Zero balance: an "EARN ›" tag pointing at the earning path — never a bare "+" next
               to a 0 (that reads as an IAP buy button, which coins deliberately are not). */
            <span
              aria-hidden
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 2,
                padding: "4px 7px",
                borderRadius: 999,
                fontSize: 9.5,
                fontWeight: 900,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                color: "var(--btnText)",
                background: "linear-gradient(180deg, color-mix(in srgb, var(--amber) 84%, white), var(--amber))",
                border: "1px solid color-mix(in srgb, var(--amber) 60%, white)",
                boxShadow: "0 2px 6px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.5)",
                lineHeight: 1,
              }}
            >
              {/* A longer localized "EARN" shrinks within this cap instead of widening the coins
                  pill (English fits well under 48px, so it never scales). */}
              <FitText
                as="span"
                size={9.5}
                min={0.66}
                style={{ display: "inline-block", maxWidth: 48, whiteSpace: "nowrap", overflow: "hidden" }}
              >
                {t.home.earnCoins}
              </FitText>
              <span style={{ fontSize: 12, fontWeight: 800, lineHeight: 1 }}>›</span>
            </span>
          ) : mono ? (
            /* Mono: a bare, quiet plus — no gold disc chrome. */
            <span
              aria-hidden
              style={{ fontSize: 17, fontWeight: 600, color: "var(--muted)", lineHeight: 1, padding: "0 2px" }}
            >
              +
            </span>
          ) : (
            <span
              aria-hidden
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                fontSize: 18,
                fontWeight: 800,
                color: "var(--btnText)",
                background: "radial-gradient(120% 120% at 35% 25%, color-mix(in srgb, var(--amber) 84%, white), var(--amber))",
                border: "1px solid color-mix(in srgb, var(--amber) 60%, white)",
                boxShadow: "0 2px 6px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.5)",
                lineHeight: 1,
              }}
            >
              +
            </span>
          )}
        </button>
        <button
          type="button"
          className="rr-tap"
          aria-label={t.home.profileAndSettings}
          onClick={onOpenMenu}
          style={{
            border: "none",
            background: "transparent",
            padding: 0,
            cursor: "pointer",
            borderRadius: "50%",
            // A utility control, not a hero: a single quiet ring — no diffuse outer glow that would
            // let it compete with the wordmark or the podium avatars. (mono: a plain hairline.)
            boxShadow: mono
              ? "0 0 0 1px var(--line)"
              : "0 0 0 1px color-mix(in srgb, var(--amber) 45%, transparent)",
          }}
        >
          {/* The chip wears the player's OWN preset portrait (Avatar picks the human character
              art on every non-Blank theme; Blank keeps its line-art mark). Only the arcade skin
              overrides it with the marquee hooded art. No presence dot — it never signalled
              anything real (there is no live-presence system), just added an accent colour. */}
          <Avatar
            size={40}
            ring={mono ? "var(--line)" : "var(--amber)"}
            preset={avatarPreset}
            frame={equippedFrame}
            art={mono ? undefined : lobbyArt.avatarHooded}
          />
        </button>
      </div>
    </header>
  );
}
