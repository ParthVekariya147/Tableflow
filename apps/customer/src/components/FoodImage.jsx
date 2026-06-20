/**
 * Renders a menu item's photo when it has one, otherwise a tasteful icon
 * stand-in. The platform menu uses icon/swatch placeholders (no uploaded
 * photos yet), so this keeps the guest cards looking intentional rather than
 * broken. `className` controls the box size (matches the original <img>).
 */
export default function FoodImage({ item, className = "" }) {
  if (item?.img) {
    return <img src={item.img} alt={item?.name ?? ""} className={className} />;
  }
  const icon = item?.icon || "restaurant";
  return (
    <div
      className={`flex items-center justify-center bg-surface-container ${className}`}
    >
      <span
        className="material-symbols-outlined text-primary/40"
        style={{ fontSize: 40 }}
      >
        {icon}
      </span>
    </div>
  );
}
