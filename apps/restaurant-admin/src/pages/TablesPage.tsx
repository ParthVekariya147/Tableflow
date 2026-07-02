import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { QRCodeCanvas } from "qrcode.react";
import { SERVICE_REQUEST_META, type ServiceRequest } from "@amber/domain";
import { Icon } from "../components/Icon";
import { useAdmin } from "../store/AdminStore";
import { useServiceRequests } from "../notifications/useServiceRequests";
import { tableQrUrl } from "../lib/tableQr";
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
  const { requests } = useServiceRequests();
  const [filter, setFilter] = useState<Filter>("all");
  const [qrTable, setQrTable] = useState<Table | null>(null);
  const [editTable, setEditTable] = useState<Table | null>(null);
  const [addOpen, setAddOpen] = useState(false);

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
        <div className="flex items-center gap-sm self-start">
          <div className="flex items-center gap-sm rounded-full border border-outline-variant bg-surface-container-high p-1">
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
          <button
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-xs rounded-full bg-primary px-md py-sm font-label-md text-label-md text-on-primary transition-colors hover:bg-primary-container"
          >
            <Icon name="add" size={18} /> Add Table
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-lg sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {tables.map((t) => (
          <TableCard
            key={t.id}
            table={t}
            requests={requests.filter((r) => r.tableId === t.id)}
            onQr={() => setQrTable(t)}
            onEdit={() => setEditTable(t)}
          />
        ))}
      </div>

      {qrTable && <QrModal table={qrTable} onClose={() => setQrTable(null)} />}
      {editTable && <EditModal table={editTable} onClose={() => setEditTable(null)} />}
      {addOpen && <AddModal onClose={() => setAddOpen(false)} />}
    </>
  );
}

function AddModal({ onClose }: { onClose: () => void }) {
  const { dispatch } = useAdmin();
  const [label, setLabel] = useState("");
  const [seats, setSeats] = useState("4");
  const [room, setRoom] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!label.trim() || saving) return;
    setSaving(true);
    await dispatch({
      type: "ADD_TABLE",
      label: label.trim(),
      seats: Math.max(1, parseInt(seats) || 1),
      room: room.trim() || undefined,
    });
    onClose();
  }

  return (
    <ModalShell onClose={onClose}>
      <h3 className="mb-md font-headline-md text-headline-md text-on-background">Add Table</h3>
      <div className="flex flex-col gap-md">
        <label className="flex flex-col gap-base">
          <span className="font-label-md text-label-md uppercase text-on-background">Label</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. T12 or Patio 3"
            className="rounded-md border border-outline-variant bg-surface px-sm py-sm font-body-md text-on-background outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </label>
        <div className="flex gap-md">
          <label className="flex min-w-0 flex-1 flex-col gap-base">
            <span className="font-label-md text-label-md uppercase text-on-background">Seats</span>
            <input
              type="number"
              min={1}
              value={seats}
              onChange={(e) => setSeats(e.target.value)}
              className="w-full rounded-md border border-outline-variant bg-surface px-sm py-sm font-data-mono text-on-background outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-base">
            <span className="font-label-md text-label-md uppercase text-on-background">Room</span>
            <input
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="e.g. Main"
              className="w-full rounded-md border border-outline-variant bg-surface px-sm py-sm font-body-md text-on-background outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </label>
        </div>
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
          disabled={saving}
          className="flex flex-1 items-center justify-center gap-xs rounded-full bg-primary px-md py-sm font-label-md text-label-md text-on-primary transition-colors hover:bg-primary-container disabled:opacity-70"
        >
          {saving && <Icon name="progress_activity" size={16} className="ag-spin" />}
          {saving ? "Adding…" : "Add Table"}
        </button>
      </div>
    </ModalShell>
  );
}

function TableCard({
  table,
  requests,
  onQr,
  onEdit,
}: {
  table: Table;
  requests: ServiceRequest[];
  onQr: () => void;
  onEdit: () => void;
}) {
  const navigate = useNavigate();
  const { dispatch } = useAdmin();
  const { acknowledge } = useServiceRequests();
  const meta = STATUS_META[table.status];
  const hasOpenRequest = requests.length > 0;

  async function primaryAction() {
    if (table.status === "free") {
      // Await the create + refetch so the session page opens on fresh data
      // (not the previous/empty snapshot for this table).
      await dispatch({ type: "OPEN_SESSION", tableId: table.id });
      navigate(`/tables/${table.id}`);
    } else if (table.status === "bill") {
      navigate(`/tables/${table.id}/billing`);
    } else {
      navigate(`/tables/${table.id}`);
    }
  }

  const actionLabel =
    table.status === "free" ? "Open Session" : table.status === "bill" ? "Checkout" : "Details";

  const hasPendingRequest = requests.some((r) => r.status === "pending");

  return (
    <div
      className={`flex h-full flex-col rounded-card bg-surface-container-lowest p-md shadow-card transition-colors ${
        hasPendingRequest
          ? "border-2 border-transparent pulse-ready"
          : "border border-outline-variant hover:border-primary"
      }`}
    >
      <div className="mb-md flex items-start justify-between">
        <div className="font-headline-md text-headline-md text-on-background">{table.label}</div>
        <span className={`flex items-center gap-xs rounded-full px-3 py-1 font-label-md text-label-md ${meta.chip}`}>
          <span className={`h-2 w-2 rounded-full ${meta.dot}`} /> {meta.label}
        </span>
      </div>
      <div className="mb-md flex items-center gap-xs font-body-md text-body-md text-on-surface-variant">
        <Icon name="group" size={18} /> {table.seats} Seats
      </div>
      {hasOpenRequest && (
        <div className="mb-lg flex flex-wrap gap-xs">
          {requests.map((r) => {
            const reqMeta = SERVICE_REQUEST_META[r.type];
            return (
              <button
                key={r.id}
                onClick={() => r.status === "pending" && void acknowledge(r.id)}
                title={
                  r.status === "pending"
                    ? `${reqMeta.label} — tap to acknowledge`
                    : `${reqMeta.label} — acknowledged`
                }
                className={`flex items-center gap-xs rounded-full px-2 py-1 font-label-md text-[11px] font-bold transition-colors ${
                  r.status === "pending"
                    ? "bg-error-container text-on-error-container hover:opacity-80"
                    : "bg-surface-container-high text-on-surface-variant"
                }`}
              >
                <Icon name={reqMeta.icon} size={14} />
                {reqMeta.label}
              </button>
            );
          })}
        </div>
      )}
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
  const qrRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const url = tableQrUrl(table.qrToken);

  async function regenerate() {
    if (regenerating) return;
    setRegenerating(true);
    await dispatch({ type: "REGEN_QR", tableId: table.id });
    // Refetch swaps `table.qrToken`, so the modal re-renders the new code.
    setRegenerating(false);
    setConfirmRegen(false);
  }

  /** Export the rendered QR canvas as a PNG so staff can print / place it. */
  function download() {
    const canvas = qrRef.current?.querySelector("canvas");
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `qr-${table.label}`.replace(/\s+/g, "-").toLowerCase() + ".png";
    a.click();
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (insecure context) — ignore */
    }
  }

  return (
    <ModalShell onClose={onClose}>
      <div className="flex flex-col items-center gap-md text-center">
        <h3 className="font-headline-md text-headline-md text-on-background">{table.label} QR Code</h3>
        {/* QR must sit on white for reliable scanning, independent of theme. */}
        <div ref={qrRef} className="rounded-lg border border-outline-variant bg-white p-3">
          <QRCodeCanvas value={url} size={180} level="M" marginSize={2} />
        </div>
        <button
          onClick={copyLink}
          title="Copy link"
          className="flex max-w-full items-center gap-xs rounded-full bg-surface-container-high px-md py-xs font-data-mono text-data-mono text-on-surface transition-colors hover:bg-surface-container-highest"
        >
          <Icon name={copied ? "check" : "content_copy"} size={14} />
          <span className="truncate">{copied ? "Copied!" : url}</span>
        </button>
        <p className="font-body-md text-body-md text-on-surface-variant">
          Guests scan this to start ordering at {table.label}.
        </p>
        {confirmRegen ? (
          <div className="mt-sm flex w-full flex-col gap-sm rounded-card border border-error/30 bg-error-container/40 p-md">
            <p className="font-body-md text-body-md text-on-surface-variant">
              Regenerating makes a <span className="font-label-md text-on-background">new</span> code.
              Any QR already printed for {table.label} will <span className="font-label-md text-error">stop working</span> and must be reprinted.
            </p>
            <div className="flex w-full gap-sm">
              <button
                onClick={() => setConfirmRegen(false)}
                disabled={regenerating}
                className="flex-1 rounded-full border border-outline px-md py-sm font-label-md text-label-md text-on-surface transition-colors hover:bg-surface-container-low disabled:opacity-70"
              >
                Keep current
              </button>
              <button
                onClick={regenerate}
                disabled={regenerating}
                className="flex flex-1 items-center justify-center gap-xs rounded-full bg-error px-md py-sm font-label-md text-label-md text-on-error transition-colors hover:bg-error/90 disabled:opacity-70"
              >
                {regenerating && <Icon name="progress_activity" size={16} className="ag-spin" />}
                {regenerating ? "Regenerating…" : "Regenerate"}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-sm flex w-full flex-col gap-sm">
            <button
              onClick={download}
              className="flex w-full items-center justify-center gap-xs rounded-full bg-primary px-md py-sm font-label-md text-label-md text-on-primary transition-colors hover:bg-primary-container"
            >
              <Icon name="download" size={18} /> Download PNG
            </button>
            <div className="flex w-full gap-sm">
              <button
                onClick={onClose}
                className="flex-1 rounded-full border border-outline px-md py-sm font-label-md text-label-md text-on-surface transition-colors hover:bg-surface-container-low"
              >
                Done
              </button>
              <button
                onClick={() => setConfirmRegen(true)}
                className="flex flex-1 items-center justify-center gap-xs rounded-full border border-outline px-md py-sm font-label-md text-label-md text-on-surface transition-colors hover:bg-surface-container-low"
              >
                <Icon name="refresh" size={18} /> Regenerate
              </button>
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

function EditModal({ table, onClose }: { table: Table; onClose: () => void }) {
  const { dispatch } = useAdmin();
  const [label, setLabel] = useState(table.label);
  const [seats, setSeats] = useState(String(table.seats));
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const busy = saving || deleting;
  const occupied = table.status !== "free";

  async function save() {
    if (busy) return;
    setSaving(true);
    await dispatch({
      type: "UPDATE_TABLE",
      tableId: table.id,
      patch: { label: label.trim() || table.label, seats: Math.max(1, parseInt(seats) || table.seats) },
    });
    onClose();
  }

  async function remove() {
    if (busy) return;
    setDeleting(true);
    await dispatch({ type: "DELETE_TABLE", tableId: table.id });
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
          disabled={busy}
          className="flex flex-1 items-center justify-center gap-xs rounded-full bg-primary px-md py-sm font-label-md text-label-md text-on-primary transition-colors hover:bg-primary-container disabled:opacity-70"
        >
          {saving && <Icon name="progress_activity" size={16} className="ag-spin" />}
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      <div className="mt-md border-t border-outline-variant/50 pt-md">
        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            disabled={busy || occupied}
            title={occupied ? "Close the active session before deleting this table" : undefined}
            className="flex w-full items-center justify-center gap-xs rounded-full border border-error/40 px-md py-sm font-label-md text-label-md text-error transition-colors hover:bg-error-container disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon name="delete" size={18} /> Delete Table
          </button>
        ) : (
          <div className="flex flex-col gap-sm">
            <p className="text-center font-body-md text-body-md text-on-surface-variant">
              Delete <span className="font-label-md text-on-background">{table.label}</span>? This can’t be undone.
            </p>
            <div className="flex gap-sm">
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="flex-1 rounded-full border border-outline px-md py-sm font-label-md text-label-md text-on-surface transition-colors hover:bg-surface-container-low disabled:opacity-70"
              >
                Keep
              </button>
              <button
                onClick={remove}
                disabled={deleting}
                className="flex flex-1 items-center justify-center gap-xs rounded-full bg-error px-md py-sm font-label-md text-label-md text-on-error transition-colors hover:bg-error/90 disabled:opacity-70"
              >
                {deleting && <Icon name="progress_activity" size={16} className="ag-spin" />}
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
}
