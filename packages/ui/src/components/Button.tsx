import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "outline" | "ghost";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  fullWidth?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary text-on-primary shadow-md",
  outline: "border-2 border-primary text-primary",
  ghost: "text-on-surface-variant",
};

/**
 * Pill-shaped button themed entirely through tenant tokens (bg-primary etc.),
 * so it adopts each restaurant's brand with no per-tenant code.
 */
export function Button({
  variant = "primary",
  fullWidth = false,
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 font-bold transition-transform active:scale-95 disabled:opacity-50 ${VARIANTS[variant]} ${fullWidth ? "w-full" : ""} ${className}`}
      {...props}
    />
  );
}
