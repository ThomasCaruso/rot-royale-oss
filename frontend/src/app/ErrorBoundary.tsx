import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * The last line of defence against a blank app.
 *
 * React unmounts the WHOLE tree when a render throws. With nothing above it, that leaves the bare
 * page background — a cream void with no text, no button, and no way back, which is exactly what a
 * player reported after a wrong answer. A crash is a bug to fix at its source; showing the player a
 * dead screen instead of a way out is a second, avoidable failure.
 *
 * Reload is the only offered action deliberately. The tree that threw is gone and its state is not
 * trustworthy, so re-rendering the same subtree would most likely throw again; a reload restores the
 * session from storage and drops the player back on the home screen with their run intact.
 *
 * Intentionally dependency-free — no i18n, no design-system imports, no hooks. Anything this screen
 * touches is code that must not itself be broken for the screen to appear.
 */
type Props = { children: ReactNode };
type State = { error: Error | null };

const wrap: React.CSSProperties = {
  minHeight: "100dvh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 14,
  padding: 24,
  textAlign: "center",
};

const button: React.CSSProperties = {
  marginTop: 6,
  padding: "12px 28px",
  borderRadius: 999,
  border: "none",
  fontSize: 15,
  fontWeight: 700,
  cursor: "pointer",
  background: "var(--lime, #C7F464)",
  color: "var(--ink, #16130F)",
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep it in the console: on a device the only way anyone sees this is a remote inspector.
    console.error("[rr] render crash", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={wrap}>
        <div style={{ fontSize: 34 }}>🫠</div>
        <div style={{ fontSize: 19, fontWeight: 700, color: "var(--ink, #16130F)" }}>
          Something broke
        </div>
        <div style={{ fontSize: 14, opacity: 0.72, maxWidth: 320, color: "var(--ink, #16130F)" }}>
          That's on us, not you. Reloading usually fixes it — your progress is saved.
        </div>
        <button type="button" style={button} onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
