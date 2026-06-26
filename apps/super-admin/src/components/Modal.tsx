import type { ReactNode } from "react";

/**
 * Centered card modal with a 40%-scrim backdrop — see DESIGN.md "Elevation &
 * Depth" (deliberately heavier shadow than cards since these gate sensitive
 * actions: master-password entry, plan changes, suspension).
 */
export function Modal({
  onClose,
  maxWidthClassName = "max-w-md",
  children,
}: {
  onClose: () => void;
  maxWidthClassName?: string;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-on-surface/40 p-3 sm:p-6"
      onClick={onClose}
    >
      <div
        className={`w-full ${maxWidthClassName} overflow-hidden rounded-2xl bg-surface-container-lowest shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
