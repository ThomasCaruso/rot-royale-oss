import { useCallback, useEffect, useState } from "react";
import { ApiError, api, type DuelConfigResponse, type DuelCreateResponse, type DuelResult, type DuelStatsResponse, type RoundSpec } from "@/api/client";
import { refreshMe } from "@/api/session";
import { useT } from "@/i18n/useT";
import { AppNav } from "@/screens/home/AppNav";
import { Centered } from "@/screens/campaign/Campaign";
import { GoldButton } from "@/ui/GoldButton";
import { DuelLobby } from "@/screens/duel/DuelLobby";
import { DuelPlay } from "@/screens/duel/DuelPlay";
import { DuelResult as DuelResultScreen } from "@/screens/duel/DuelResult";
import { errorMessage } from "@/i18n/errors";

type Stage = "lobby" | "starting" | "playing" | "result";

interface ActiveMatch {
  matchId: string;
  rounds: RoundSpec[];
  rivalTier: string;
  duelType: string;
  entryGems: number;
  poolGems: number;
}

/**
 * Duel flow container (Campaign-style): owns the lobby → playing → result state machine,
 * fetches the tier config on mount, and renders its own AppNav on the flat (non-immersive) stages so
 * Home/Campaign/Leaderboard/Vault stay one tap away. The playing stage is immersive (no nav).
 *
 * Error handling on create maps the server's typed errors to friendly inline copy and keeps the
 * player in the lobby (insufficient_gems → try Training; cap reached; locked tier). After a duel
 * completes, the wallet/profile is refreshed so the Gem balance reflects immediately.
 */
export function DuelFlow({
  onExit,
  onCampaign,
  onLeaderboard,
  onVault,
  onPlay,
  onQuickPlay,
}: {
  onExit: () => void;
  onCampaign: () => void;
  onLeaderboard: () => void;
  onVault: () => void;
  onPlay: (windowId: string) => void;
  onQuickPlay?: () => void;
}) {
  const t = useT();
  const [config, setConfig] = useState<DuelConfigResponse | null>(null);
  // Lifetime duel stats for the lobby's stakes framing (record + streak-on-the-line). Non-blocking
  // and optional — the lobby renders fine without them if the fetch fails.
  const [stats, setStats] = useState<DuelStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [stage, setStage] = useState<Stage>("lobby");
  const [match, setMatch] = useState<ActiveMatch | null>(null);
  const [result, setResult] = useState<DuelResult | null>(null);
  // Inline notice shown in the lobby when a create attempt is rejected (kept human-readable).
  const [notice, setNotice] = useState("");

  const loadConfig = useCallback(async () => {
    const c = await api.duelConfig();
    setConfig(c);
    return c;
  }, []);

  useEffect(() => {
    loadConfig()
      .catch((err) => setLoadError(errorMessage(err, t, t.duel.loadError)))
      .finally(() => setLoading(false));
    api
      .duelStats()
      .then(setStats)
      .catch(() => undefined);
  }, [loadConfig, t]);

  const startDuel = useCallback(
    async (type: string) => {
      setNotice("");
      // Straight from the lobby CTA into the match — show the "Starting duel…" loader while create()
      // is in flight (no intermediary confirm screen), then drop into play.
      setStage("starting");
      try {
        const res: DuelCreateResponse = await api.createDuel(type);
        setMatch({
          matchId: res.match_id,
          rounds: res.rounds,
          rivalTier: res.rival_tier,
          duelType: res.duel_type,
          entryGems: res.entry_gems,
          poolGems: res.pool_gems,
        });
        setStage("playing");
      } catch (err) {
        if (err instanceof ApiError) {
          setNotice(createErrorMessage(err, t));
        } else {
          setNotice(t.duel.loadError);
        }
        setStage("lobby");
        // Refresh config so the (possibly changed) cap/balance is reflected after a rejected attempt.
        void loadConfig().catch(() => undefined);
      }
    },
    [t, loadConfig],
  );

  const onFinished = useCallback(
    async (r: DuelResult) => {
      setResult(r);
      setStage("result");
      // Gems moved — refresh the profile + the lobby config so balances are current on return.
      await Promise.allSettled([refreshMe(), loadConfig()]);
    },
    [loadConfig],
  );

  if (loading) return <Centered>{t.duel.lobbyTitle}…</Centered>;
  if (loadError && !config) {
    return (
      <Centered>
        <div style={{ color: "var(--pink)", marginBottom: 16, fontWeight: 700 }}>{loadError}</div>
        <GoldButton idlePulse={false} onClick={onExit} style={{ maxWidth: 240 }}>
          {t.duel.home}
        </GoldButton>
      </Centered>
    );
  }
  if (!config) return null;

  const nav = (
    <AppNav
      active="none"
      onHome={onExit}
      onCampaign={onCampaign}
      onLeaderboard={onLeaderboard}
      onVault={onVault}
      onPlayWindow={onPlay}
      onQuickPlay={onQuickPlay}
    />
  );

  if (stage === "playing" && match) {
    return (
      <DuelPlay
        matchId={match.matchId}
        rounds={match.rounds}
        duelType={match.duelType}
        entryGems={match.entryGems}
        poolGems={match.poolGems}
        rivalTier={match.rivalTier}
        onFinished={onFinished}
        onExit={() => setStage("lobby")}
      />
    );
  }

  if (stage === "result" && result && match) {
    return (
      <>
        <DuelResultScreen
          result={result}
          duelType={match.duelType}
          onRunItBack={() => startDuel(match.duelType)}
          onHome={onExit}
        />
        {nav}
      </>
    );
  }

  if (stage === "starting") {
    return <Centered>{t.duel.startingDuel}</Centered>;
  }

  // Default: lobby.
  return (
    <>
      {notice && (
        <div style={noticeBar} role="status">
          {notice}
        </div>
      )}
      <DuelLobby
        config={config}
        stats={stats}
        onSelectTier={(type) => {
          void startDuel(type);
        }}
        onBack={onExit}
      />
      {nav}
    </>
  );
}

/** Map a create() ApiError to friendly inline lobby copy (all from the guarded `duel` namespace). */
function createErrorMessage(err: ApiError, t: ReturnType<typeof useT>): string {
  const m = err.message.toLowerCase();
  if (err.status === 429 || m.includes("cap")) return t.duel.capReached;
  if (err.status === 403 || m.includes("lock")) return t.duel.lockedMsg;
  if (err.status === 400 || m.includes("gem")) return t.duel.notEnoughGems;
  return t.duel.notEnoughGems;
}

const noticeBar: React.CSSProperties = {
  position: "fixed",
  top: "calc(env(safe-area-inset-top) + 10px)",
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 50,
  maxWidth: 360,
  width: "calc(100% - 28px)",
  textAlign: "center",
  padding: "11px 16px",
  borderRadius: 14,
  background: "color-mix(in srgb, var(--pink) 24%, var(--panel))",
  border: "1px solid color-mix(in srgb, var(--pink) 50%, transparent)",
  color: "var(--text)",
  fontWeight: 700,
  fontSize: 13,
  boxShadow: "0 12px 30px rgba(0,0,0,.45)",
};
