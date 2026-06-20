import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../components/Icon";
import { useAdmin } from "../store/AdminStore";
import type { Table, TableStatus } from "../data/types";

const STATUS_META: Record<
  TableStatus,
  { label: string; chip: string; dot: string }
> = {
  free: { label: "Free", chip: "bg-secondary-container text-on-secondary-container", dot: "bg-on-secondary-container" },
  seated: { label: "Seated", chip: "bg-primary-container text-on-primary-container", dot: "bg-on-primary-container" },
  ordering: { label: "Ordering", chip: "bg-[#fff8e1] text-[#f57f17]", dot: "bg-[#f57f17]" },
  bill: { label: "Awaiting Bill", chip: "bg-tertiary-container text-on-tertiary-container", dot: "bg-on-tertiary-container" },
};

type Filter = "all" | "free" | "occupied";

export function TablesPage() {
  const { state } = useAdmin();
  const [filter, setFilter] = useState<Filter>("all");
  const [qrTable, setQrTable] = useState<Table | null>(null);
  const [editTable, setEditTable] = useState<Table | null>(null);

  const tables = state.tables.filter((t) => {
    if (filter === "free") return t.status === "free";
    if (filter === "occupied") return t.status !== "free";
    return true;
  });

  return (
    <>
      <div className="mb-lg flex flex-col justify-between gap-md md:flex-row md:items-end">
        <div>
          <h2 className="font-headline-lg text-headline-lg text-on-background">Floor Overview</h2>
          <p className="mt-xs font-body-md text-body-md text-on-surface-variant">
            Real-time table status and session management.
          </p>
        </div>
        <div className="flex items-center gap-sm self-start rounded-full border border-outline-variant bg-surface-container-high p-1">
          {(["all", "free", "occupied"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-md py-sm font-label-md text-label-md capitalize transition-all ${
                filter === f
                  ? "bg-surface-container-lowest text-primary shadow-sm"
                  : "text-on-surface-variant hover:text-primary"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-lg sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {tables.map((t) => (
          <TableCard
            key={t.id}
            table={t}
            onQr={() => setQrTable(t)}
            onEdit={() => setEditTable(t)}
          />
        ))}
      </div>

      {qrTable && <QrModal table={qrTable} onClose={() => setQrTable(null)} />}
      {editTable && <EditModal table={editTable} onClose={() => setEditTable(null)} />}
    </>
  );
}

function TableCard({
  table,
  onQr,
  onEdit,
}: {
  table: Table;
  onQr: () => void;
  onEdit: () => void;
}) {
  const navigate = useNavigate();
  const { dispatch } = useAdmin();
  const meta = STATUS_META[table.status];

  function primaryAction() {
    if (table.status === "free") {
      dispatch({ type: "OPEN_SESSION", tableId: table.id });
      navigate(`/tables/${table.id}`);
    } else if (table.status === "bill") {
      navigate(`/tables/${table.id}/billing`);
    } else {
      navigate(`/tables/${table.id}`);
    }
  }

  const actionLabel =
    table.status === "free" ? "Open Session" : table.status === "bill" ? "Checkout" : "Details";

  return (
    <div className="flex h-full flex-col rounded-card border border-outline-variant bg-surface-container-lowest p-md shadow-card transition-colors hover:border-primary">
      <div className="mb-md flex items-start justify-between">
        <div className="font-headline-md text-headline-md text-on-background">{table.label}</div>
        <span className={`flex items-center gap-xs rounded-full px-3 py-1 font-label-md text-label-md ${meta.chip}`}>
          <span className={`h-2 w-2 rounded-full ${meta.dot}`} /> {meta.label}
        </span>
      </div>
      <div className="mb-lg flex items-center gap-xs font-body-md text-body-md text-on-surface-variant">
        <Icon name="group" size={18} /> {table.seats} Seats
      </div>
      <div className="mt-auto flex items-center justify-between border-t border-outline-variant/50 pt-md">
        <div className="flex gap-xs text-on-surface-variant">
          <button onClick={onQr} title="QR Token" className="p-1 transition-colors hover:text-primary">
            <Icon name="qr_code" size={20} />
          </button>
          <button onClick={onEdit} title="Edit Table" className="p-1 transition-colors hover:text-primary">
            <Icon name="edit" size={20} />
          </button>
        </div>
        <button
          onClick={primaryAction}
          className={`rounded-full px-sm py-1 font-label-md text-label-md transition-colors ${
            table.status === "free"
              ? "bg-primary text-on-primary hover:bg-primary-container"
              : table.status === "bill"
                ? "border border-tertiary text-tertiary hover:bg-tertiary-fixed"
                : "border border-outline text-on-surface-variant hover:bg-surface-container-highest"
          }`}
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

function ModalShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-on-background/20 p-md backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm animate-scale-in rounded-card border border-outline-variant bg-surface-container-lowest p-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function QrModal({ table, onClose }: { table: Table; onClose: () => void }) {
  const { dispatch } = useAdmin();
  return (
    <ModalShell onClose={onClose}>
      <div className="flex flex-col items-center gap-md text-center">
        <h3 className="font-headline-md text-headline-md text-on-background">{table.label} QR Token</h3>
        <div className="flex h-44 w-44 items-center justify-center rounded-lg border border-outline-variant bg-surface">
          <Icon name="qr_code_2" size={140} className="text-on-background" />
        </div>
        <span className="rounded-full bg-surface-container-high px-md py-xs font-data-mono text-data-mono text-on-surface">
          {table.qrToken}
        </span>
        <p className="font-body-md text-body-md text-on-surface-variant">
          Guests scan this to start ordering at {table.label}.
        </p>
        <div className="mt-sm flex w-full gap-sm">
          <button
            onClick={onClose}
            className="flex-1 rounded-full border border-outline px-md py-sm font-label-md text-label-md text-on-surface transition-colors hover:bg-surface-container-low"
          >
            Done
          </button>
          <button
            onClick={() => dispatch({ type: "REGEN_QR", tableId: table.id })}
            className="flex flex-1 items-center justify-center gap-xs rounded-full bg-primary px-md py-sm font-label-md text-label-md text-on-primary transition-colors hover:bg-primary-container"
          >
            <Icon name="refresh" size={18} /> Regenerate
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function EditModal({ table, onClose }: { table: Table; onClose: () => void }) {
  const { dispatch } = useAdmin();
  const [label, setLabel] = useState(table.label);
  const [seats, setSeats] = useState(String(table.seats));

  function save() {
    dispatch({
      type: "UPDATE_TABLE",
      tableId: table.id,
      patch: { label: label.trim() || table.label, seats: Math.max(1, parseInt(seats) || table.seats) },
    });
    onClose();
  }

  return (
    <ModalShell onClose={onClose}>
      <h3 className="mb-md font-headline-md text-headline-md text-on-background">Edit {table.label}</h3>
      <div className="flex flex-col gap-md">
        <label className="flex flex-col gap-base">
          <span className="font-label-md text-label-md uppercase text-on-background">Label</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="rounded-md border border-outline-variant bg-surface px-sm py-sm font-body-md text-on-background outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </label>
        <label className="flex flex-col gap-base">
          <span className="font-label-md text-label-md uppercase text-on-background">Seats</span>
          <input
            type="number"
            min={1}
            value={seats}
            onChange={(e) => setSeats(e.target.value)}
            className="rounded-md border border-outline-variant bg-surface px-sm py-sm font-data-mono text-on-background outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </label>
      </div>
      <div className="mt-lg flex gap-sm">
        <button
          onClick={onClose}
          className="flex-1 rounded-full border border-outline px-md py-sm font-label-md text-label-md text-on-surface transition-colors hover:bg-surface-container-low"
        >
          Cancel
        </button>
        <button
          onClick={save}
          className="flex-1 rounded-full bg-primary px-md py-sm font-label-md text-label-md text-on-primary transition-colors hover:bg-primary-container"
        >
          Save
        </button>
      </div>
    </ModalShell>
  );
}
