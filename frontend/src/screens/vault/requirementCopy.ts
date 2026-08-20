import { fmt, type useT } from "@/i18n/useT";

/**
 * Goal-framed copy for a locked cosmetic's unlock requirement, parsed from the server requirement
 * string (see backend cosmetics.py grammar). One place both VaultItemCard and FrameCard resolve
 * "how do I unlock this" — no urgency, no timers. Unknown/absent → null (card falls back to blurb).
 */
export function requirementCopy(
  requirement: string | null | undefined,
  t: ReturnType<typeof useT>,
): string | null {
  if (!requirement) return null;
  if (requirement === "all_worlds") return t.vault.requireAllWorlds;
  const parts = requirement.split(":");
  const verb = parts[0];
  if (verb === "world") return fmt(t.vault.requireWorld, { world: parts.slice(1).join(":") });
  if (verb === "division") return fmt(t.vault.requireDivision, { division: parts[1] ?? "" });
  if (verb === "duel_tier")
    return fmt(t.vault.requireDuelTier, { tier: titleCase(parts[1] ?? "") });
  if (verb === "level")
    return fmt(t.vault.requireLevel, { world: parts[1] ?? "", n: parts[2] ?? "" });
  if (verb === "founder") return fmt(t.vault.requireFounder, { n: parts[1] ?? "" });
  if (verb === "royales") return fmt(t.vault.requireRoyales, { n: parts[1] ?? "" });
  return null;
}

function titleCase(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
