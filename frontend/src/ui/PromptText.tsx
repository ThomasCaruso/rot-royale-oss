/**
 * The in-round question type treatment, shared by every DOM round module so a Royale run reads as
 * ONE game rather than a set of differently-typeset screens.
 *
 * The trailing keyword of a question is lifted into brand violet — it lands the emphasis where the
 * question actually turns ("...how many EARTHS?"). Skipped for equations (rapid_math) and for any
 * prompt that isn't a question, where highlighting a final word would be arbitrary.
 */
export function PromptText({ text, style }: { text: string; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        fontSize: "clamp(20px, 5.2vw, 25px)",
        fontWeight: 800,
        lineHeight: 1.32,
        letterSpacing: "-0.01em",
        margin: "4px 0 20px",
        ...style,
      }}
    >
      <Highlighted text={text} />
    </div>
  );
}

function Highlighted({ text }: { text: string }) {
  const isEquation = text.includes("=");
  if (isEquation || !text.trim().endsWith("?")) {
    return <>{text}</>;
  }
  const body = text.replace(/\?$/, "");
  const parts = body.split(" ");
  const last = parts.pop() ?? "";
  return (
    <>
      {parts.join(" ")} <span style={{ color: "var(--brand-2)" }}>{last}</span>?
    </>
  );
}
