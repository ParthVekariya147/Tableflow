import { useState } from "react";

export default function FoodImage({ item, className = "" }) {
  const [failed, setFailed] = useState(false);

  if (item?.img && !failed) {
    return (
      <img
        src={item.img}
        alt={item?.name ?? ""}
        className={className}
        onError={() => setFailed(true)}
      />
    );
  }

  const icon = item?.icon || "restaurant";
  const swatch = item?.swatch || "from-surface-container to-surface-container-highest";
  return (
    <div
      className={`flex items-center justify-center bg-gradient-to-br ${swatch} ${className}`}
    >
      <span
        className="material-symbols-outlined text-white/60 drop-shadow"
        style={{ fontSize: 40 }}
      >
        {icon}
      </span>
    </div>
  );
}
