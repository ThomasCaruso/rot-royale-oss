import { LegalShell, LegalSection } from "./LegalShell";
import { legalLink } from "./styles";

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "What is Rot Royale?",
    a: "A fast daily trivia game: answer short rounds, build a daily streak, and climb ranks. Includes a shared Daily Royale, practice, battle modes, and a campaign.",
  },
  {
    q: "Is it free?",
    a: "Yes. No purchases, deposits, withdrawals, cash prizes, or real-money wagering. Ranks and rewards are virtual with no cash value.",
  },
  {
    q: "Do I need an account?",
    a: "An account saves your progress, streaks, and rank across devices. You sign up with an email and display name.",
  },
  {
    q: "How do ranks and streaks work?",
    a: "Play daily to keep your streak; ranked performance moves you up or down. Miss a day and your streak resets.",
  },
  {
    q: "Found a bug or wrong answer?",
    a: (
      <>
        Email{" "}
        <a href="mailto:thomas@webhorizondigital.com" style={legalLink}>
          thomas@webhorizondigital.com
        </a>{" "}
        with the question/screen and what you expected.
      </>
    ),
  },
  {
    q: "How do I delete my account or data?",
    a: (
      <>
        Use the "Delete account" option in the app, or email{" "}
        <a href="mailto:thomas@webhorizondigital.com" style={legalLink}>
          thomas@webhorizondigital.com
        </a>{" "}
        from your account's email address to request deletion. See the{" "}
        <a href="/privacy" style={legalLink}>
          Privacy Policy
        </a>{" "}
        for details.
      </>
    ),
  },
];

export function SupportPage() {
  return (
    <LegalShell title="Support">
      <p>
        We read every message and reply as fast as we can. Email{" "}
        <a href="mailto:thomas@webhorizondigital.com" style={legalLink}>
          thomas@webhorizondigital.com
        </a>{" "}
        with your device, app version, and what happened; screenshots help.
      </p>

      <LegalSection heading="Frequently asked questions">
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {FAQ.map(({ q, a }) => (
            <div
              key={q}
              style={{ display: "flex", flexDirection: "column", gap: 4 }}
            >
              <p style={{ fontWeight: 800, color: "var(--text)" }}>{q}</p>
              <p style={{ color: "var(--muted)", lineHeight: 1.65 }}>{a}</p>
            </div>
          ))}
        </div>
      </LegalSection>
    </LegalShell>
  );
}
