import type { ReactNode } from "react";
import { Icon } from "./Icon";

/** Centered modal dialog with a header + scrollable body, on a dimmed backdrop. */
export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-md"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-[560px] flex-col rounded-card bg-surface-container-lowest shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-outline-variant px-xl py-lg">
          <h2 className="font-headline-md text-[20px] font-bold text-on-surface">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="rounded-full p-xs text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-on-surface"
            aria-label="Close"
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-xl py-lg">{children}</div>
        {footer && (
          <footer className="flex justify-end gap-sm border-t border-outline-variant px-xl py-lg">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
