/**
 * Cognition playtest harness — deliberately ugly. No Brainy, no purple glass, no animation, no
 * theming. The point is to answer one question fast: is a non-trivia cognitive round fun enough
 * that you reach for it unprompted? (see the cognition context doc §7.)
 *
 * Estimate and change detection. `span` and `crowd` were removed pre-launch (docs/architecture.md §4).
 * Change plays through the REAL round component so this exercises what ships.
 *
 * Everything is server-authoritative — this file only renders specs and submits inputs.
 */
import { useCallback, useEffect, useState } from "react";
import {
  api,
  ApiError,
  type CogChangeStart,
  type CogEstimateResolve,
  type CogEstimateStart,
} from "@/api/client";
import { ChangeRound } from "@/modules/changeDetection/ChangeRound";
import { LogSlider } from "@/modules/estimate/LogSlider";
import { clamp, fmtNum, geomMid, roundNice } from "@/modules/estimate/logScale";

// --- plain styles (intentionally not theme tokens) ---
const wrap: React.CSSProperties = {
  minHeight: "100dvh",
  background: "#fff",
  color: "#111",
  font: "16px/1.45 -apple-system, system-ui, sans-serif",
  padding: "16px 16px calc(24px + env(safe-area-inset-bottom))",
  maxWidth: 560,
  margin: "0 auto",
  boxSizing: "border-box",
};
const btn: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "14px 16px",
  margin: "8px 0",
  fontSize: 17,
  fontWeight: 700,
  color: "#111",
  background: "#f4f4f4",
  border: "2px solid #111",
  borderRadius: 8,
  cursor: "pointer",
  textAlign: "left",
};
const smallBtn: React.CSSProperties = {
  ...btn,
  display: "inline-block",
  width: "auto",
  padding: "8px 12px",
  fontSize: 14,
  margin: "4px 6px 4px 0",
};
const input: React.CSSProperties = {
  width: "100%",
  padding: 12,
  fontSize: 20,
  border: "2px solid #111",
  borderRadius: 8,
  boxSizing: "border-box",
  fontFamily: "inherit",
};
const err: React.CSSProperties = { color: "#b00", fontWeight: 700, margin: "8px 0" };
const note: React.CSSProperties = { color: "#555", fontSize: 14 };

function errText(e: unknown): string {
  return e instanceof ApiError ? `${e.status} ${e.message}` : String(e);
}

// ---------------------------------------------------------------------------------- SPAN
// ---------------------------------------------------------------------------------- ESTIMATE
const VERDICTS = ["good", "boring", "unfair", "repetitive", "broken"] as const;


function EstimatePlayer({ onExit }: { onExit: () => void }) {
  const [spec, setSpec] = useState<CogEstimateStart["spec"] | null>(null);
  const [id, setId] = useState<string | null>(null);
  const [value, setValue] = useState(0);
  const [bounds, setBounds] = useState<{ min: number; max: number } | null>(null);
  const [feedback, setFeedback] = useState<string[]>([]);
  const [reveal, setReveal] = useState<CogEstimateResolve | null>(null);
  const [error, setError] = useState("");
  const [verdictMsg, setVerdictMsg] = useState("");
  const [verdictNote, setVerdictNote] = useState("");

  const start = useCallback(async () => {
    setError("");
    setFeedback([]);
    setReveal(null);
    setBounds(null);
    setVerdictMsg("");
    setVerdictNote("");
    try {
      const s = await api.cogEstimateStart();
      setId(s.instance_id);
      setSpec(s.spec);
      setBounds({ min: s.spec.slider_min, max: s.spec.slider_max });
      setValue(geomMid(s.spec.slider_min, s.spec.slider_max)); // start centred on the log axis
    } catch (e) {
      setError(errText(e));
    }
  }, []);

  useEffect(() => {
    void start();
  }, [start]);

  const guess = useCallback(async () => {
    if (!id) return;
    const v = roundNice(value);
    setError("");
    try {
      const r = await api.cogEstimateGuess(id, v);
      const line = r.correct
        ? `✅ ${v.toLocaleString()} — correct! (+${r.points})`
        : `${v.toLocaleString()} — go ${r.direction} · ${r.band} (${r.guesses_left} left)`;
      setFeedback((f) => [...f, line]);
      if (r.done) {
        const res = await api.cogEstimateResolve(id);
        setReveal(res);
      } else {
        // The SERVER narrowed the range; re-scale the slider to it but LEAVE the handle at the
        // player's last guess (only clamped into the new range), not back at the midpoint.
        setBounds({ min: r.slider_min, max: r.slider_max });
        setValue((v) => clamp(v, r.slider_min, r.slider_max));
      }
    } catch (e) {
      setError(errText(e));
    }
  }, [id, value]);

  const rate = useCallback(
    async (verdict: string) => {
      if (!reveal?.id) {
        setVerdictMsg("no item id — can't rate");
        return;
      }
      try {
        await api.cogEstimateVerdict(reveal.id, verdict, verdictNote.trim() || null);
        setVerdictMsg(`rated "${verdict}"${verdictNote.trim() ? " + note" : ""} ✓`);
      } catch (e) {
        setVerdictMsg(
          e instanceof ApiError && e.status === 403
            ? "not an admin — add your email to ADMIN_EMAILS on the server"
            : errText(e),
        );
      }
    },
    [reveal, verdictNote],
  );

  return (
    <div>
      <h2>ESTIMATE — Fermi</h2>
      {error && <p style={err}>{error}</p>}
      {spec && bounds && !reveal && (
        <div>
          <p style={{ fontSize: 20, fontWeight: 700 }}>{spec.prompt}</p>
          <p style={note}>
            Drag to your estimate in <b>{spec.unit ?? "units"}</b> · difficulty: {spec.difficulty} ·
            up to {spec.max_guesses} guesses
          </p>
          <LogSlider min={bounds.min} max={bounds.max} value={value} onChange={setValue} />
          <button style={btn} onClick={guess}>
            Lock in {fmtNum(value)} {spec.unit ?? ""}
          </button>
          {feedback.map((f, i) => (
            <p key={i} style={{ fontWeight: 700 }}>
              {f}
            </p>
          ))}
        </div>
      )}
      {reveal && (
        <div>
          {feedback.map((f, i) => (
            <p key={i} style={note}>
              {f}
            </p>
          ))}
          <p style={{ fontSize: 22, fontWeight: 800 }}>
            Answer: {reveal.answer.toLocaleString()} {reveal.unit ?? ""} · scored {reveal.points}/3
          </p>
          <p>{reveal.reveal_explanation}</p>
          {reveal.intuition_note && <p style={note}>💡 {reveal.intuition_note}</p>}

          <hr style={{ margin: "16px 0" }} />
          <p style={note}>
            Rate this item {reveal.id ? `(${reveal.id})` : "(no id — not from the content set)"}:
          </p>
          <div>
            {VERDICTS.map((v) => (
              <button key={v} style={smallBtn} onClick={() => rate(v)}>
                {v}
              </button>
            ))}
          </div>
          <textarea
            style={{ ...input, fontSize: 15, minHeight: 56, marginTop: 8 }}
            placeholder="optional note (why boring/repetitive/broken?)"
            value={verdictNote}
            onChange={(e) => setVerdictNote(e.target.value)}
          />
          {verdictMsg && <p style={{ fontWeight: 700 }}>{verdictMsg}</p>}

          <button style={btn} onClick={start}>
            Next question →
          </button>
        </div>
      )}
      <button style={smallBtn} onClick={onExit}>
        ← back to menu
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------------- CROWD

// --- change detection -------------------------------------------------------------------------
/**
 * Plays a standalone change round through the REAL round component, not a harness copy — the point
 * of a playtest is to exercise what ships. The Royale draws change rounds only when the day's plan
 * includes one, so this is the only way to hit the mode on demand.
 */
function ChangePlayer({ onExit }: { onExit: () => void }) {
  const [spec, setSpec] = useState<(CogChangeStart["spec"] & { cognition_instance_id: string }) | null>(null);
  const [result, setResult] = useState<{ hit?: boolean; points?: number; bbox?: Record<string, number> } | null>(null);
  const [err, setErr] = useState("");

  const start = useCallback(async () => {
    setErr("");
    setResult(null);
    setSpec(null);
    try {
      const s = await api.cogChangeStart();
      setSpec({ ...s.spec, cognition_instance_id: s.instance_id });
    } catch (e) {
      setErr(e instanceof ApiError ? `${e.status} ${e.message}` : String(e));
    }
  }, []);

  useEffect(() => {
    void start();
  }, [start]);

  if (err) {
    return (
      <div>
        <h2>CHANGE — spot the difference</h2>
        <p style={note}>couldn&apos;t start: {err}</p>
        <button style={smallBtn} onClick={onExit}>← back</button>
      </div>
    );
  }
  if (result) {
    const b = result.bbox;
    return (
      <div>
        <h2>{result.hit ? "HIT" : "MISS"}</h2>
        <p style={note}>
          {result.points ?? 0} points.{" "}
          {b ? `the change was at x${b.x?.toFixed(3)} y${b.y?.toFixed(3)} (w${b.w?.toFixed(3)} h${b.h?.toFixed(3)})` : ""}
        </p>
        <button style={btn} onClick={() => void start()}>another one</button>
        <button style={smallBtn} onClick={onExit}>← back</button>
      </div>
    );
  }
  if (!spec) return <p style={note}>loading…</p>;
  return (
    <div>
      <ChangeRound
        spec={spec}
        onComplete={(r) => setResult(r as { hit?: boolean; points?: number; bbox?: Record<string, number> })}
      />
      <button style={smallBtn} onClick={onExit}>← back</button>
    </div>
  );
}

// ---------------------------------------------------------------------------------- menu
type Mode = "menu" | "estimate" | "change";

export function CognitionPlaytest({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = useState<Mode>("menu");
  return (
    <div style={wrap}>
      {mode === "menu" && (
        <div>
          <h1>🧪 New modes — playtest</h1>
          <p style={note}>
            Rough harness for the new cognitive rounds. Ugly on purpose. Rate estimate items as you
            play — do the 14 <code>fer_*</code> calibration items first.
          </p>
          <button style={btn} onClick={() => setMode("estimate")}>
            ESTIMATE — reason your way to a number
          </button>
          <button style={btn} onClick={() => setMode("change")}>
            CHANGE — spot the difference
          </button>

          <button style={smallBtn} onClick={onBack}>
            ← back to home
          </button>
        </div>
      )}
      {mode === "estimate" && <EstimatePlayer onExit={() => setMode("menu")} />}
      {mode === "change" && <ChangePlayer onExit={() => setMode("menu")} />}
    </div>
  );
}
