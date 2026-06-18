import { useSession } from "../context/SessionContext";

export default function Toast() {
  const { toast } = useSession();
  if (!toast) return null;

  return (
    <div
      key={toast.id}
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] toast-in"
    >
      <div className="flex items-center gap-2 bg-inverse-surface text-inverse-on-surface px-4 py-3 rounded-full shadow-lg text-[14px] font-medium whitespace-nowrap">
        <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>
          {toast.icon}
        </span>
        {toast.msg}
      </div>
    </div>
  );
}
