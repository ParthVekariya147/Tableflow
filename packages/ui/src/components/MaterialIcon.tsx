import type { CSSProperties } from "react";

export interface MaterialIconProps {
  name: string;
  /** Render the filled variant. */
  filled?: boolean;
  /** Font size in px. */
  size?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * Material Symbols icon. Apps must load the Material Symbols Outlined font
 * (via index.html <link>); this just renders the ligature + FILL axis.
 */
export function MaterialIcon({
  name,
  filled = false,
  size = 24,
  className = "",
  style,
}: MaterialIconProps) {
  return (
    <span
      className={`material-symbols-outlined leading-none ${className}`}
      style={{
        fontSize: size,
        fontVariationSettings: `'FILL' ${filled ? 1 : 0}`,
        ...style,
      }}
    >
      {name}
    </span>
  );
}
