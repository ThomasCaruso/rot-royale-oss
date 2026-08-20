/**
 * Display heading (DESIGN §3). Flat, bold, and letter-spaced by default; pass `pop` to add the 3D
 * extrude — reserved for the "ROT ROYALE" wordmark only. `gold` tints it treasure-gold.
 */
export function Display({
  children,
  gold = false,
  pop = false,
  className = "",
  style,
  as: Tag = "div",
}: {
  children: React.ReactNode;
  gold?: boolean;
  pop?: boolean;
  className?: string;
  style?: React.CSSProperties;
  as?: keyof React.JSX.IntrinsicElements;
}) {
  const classes = `display${pop ? " display-3d" : ""}${gold ? " gold" : ""}${className ? ` ${className}` : ""}`;
  return (
    <Tag className={classes} style={style}>
      {children}
    </Tag>
  );
}
