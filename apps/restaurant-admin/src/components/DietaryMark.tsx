/**
 * Indian-menu dietary markers: a green square+dot (veg), red square+triangle
 * (non-veg), and an independent green "J" circle (Jain). Colors are the fixed
 * real-world convention (NOT tenant-themed), so they're hardcoded as hex.
 */
const VEG = "#16a34a";
const NONVEG = "#dc2626";

export function DietaryMark({
  dietary,
  jain,
  size = 16,
  className = "",
}: {
  dietary?: "veg" | "non_veg" | null;
  jain?: boolean;
  size?: number;
  className?: string;
}) {
  if (!dietary && !jain) return null;
  const color = dietary === "veg" ? VEG : NONVEG;
  const inner = Math.round(size * 0.6);

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {dietary && (
        <span
          title={dietary === "veg" ? "Vegetarian" : "Non-vegetarian"}
          className="grid place-items-center rounded-[3px] bg-white"
          style={{ width: size, height: size, border: `1.5px solid ${color}` }}
        >
          {dietary === "veg" ? (
            <span
              className="rounded-full"
              style={{ width: inner * 0.7, height: inner * 0.7, background: color }}
            />
          ) : (
            <svg width={inner} height={inner} viewBox="0 0 10 10" aria-hidden>
              <polygon points="5,1 9,9 1,9" fill={color} />
            </svg>
          )}
        </span>
      )}
      {jain && (
        <span
          title="Jain"
          className="grid place-items-center rounded-full bg-white font-bold leading-none"
          style={{
            width: size,
            height: size,
            border: `1.5px solid ${VEG}`,
            color: VEG,
            fontSize: Math.round(size * 0.62),
          }}
        >
          J
        </span>
      )}
    </span>
  );
}
