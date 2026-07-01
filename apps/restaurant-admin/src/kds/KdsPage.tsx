import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { MaterialIcon, useTenant } from "@amber/ui";
import type { KdsStage } from "@amber/api-client";
import { useKds } from "./useKds";
import { KdsColumn } from "./KdsColumn";
import { Clock } from "./useTick";

const COLUMNS: { stage: KdsStage; title: string; badge?: string }[] = [
  { stage: "placed", title: "New", badge: "Pending" },
  { stage: "preparing", title: "Preparing" },
  { stage: "ready", title: "Ready" },
];

const STATION_KEY = "kds.stationName";

export function KdsPage() {
  const { tickets, connected, advance, advancingIds } = useKds();
  const activeCount = tickets.filter((t) => t.stage !== "served").length;
  const tenant = useTenant();
  const location = useLocation();
  const isFullScreen = location.pathname === "/kds/display";

  // Settings panel state
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stationName, setStationName] = useState(
    () => localStorage.getItem(STATION_KEY) ?? "Main Kitchen · Station 01",
  );
  const [stationDraft, setStationDraft] = useState(stationName);

  useEffect(() => {
    if (settingsOpen) setStationDraft(stationName);
  }, [settingsOpen, stationName]);

  function saveSettings() {
    const name = stationDraft.trim() || "Main Kitchen · Station 01";
    setStationName(name);
    localStorage.setItem(STATION_KEY, name);
    setSettingsOpen(false);
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background text-on-surface">
      <main className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-16 flex justify-between items-center w-full px-6 bg-surface border-b border-outline-variant shrink-0 z-20">
          <div className="flex items-center gap-4">
            <span className="font-serif text-2xl font-bold text-primary italic">
              {tenant.name}
            </span>
            <div className="h-6 w-px bg-outline-variant" />
            <div className="flex flex-col -space-y-1">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    connected ? "bg-tertiary animate-pulse" : "bg-error"
                  }`}
                />
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">
                  {connected ? "Live" : "Connecting…"}
                </span>
              </div>
              <span className="text-[12px] text-on-surface-variant font-bold">
                {stationName}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-[22px] font-serif font-semibold text-primary tabular-nums">
              <Clock />
            </div>
            <span className="text-[14px] font-bold text-primary bg-secondary-fixed px-3 py-1 rounded-full border border-secondary">
              {activeCount} Orders
            </span>
            {!isFullScreen && (
              <a
                href="/kds/display"
                target="_blank"
                rel="noreferrer"
                title="Open full-screen kitchen board"
                className="text-primary hover:bg-surface-container-high transition-colors p-2 rounded-full"
              >
                <MaterialIcon name="open_in_full" size={20} />
              </a>
            )}
            <button
              onClick={() => setSettingsOpen(true)}
              title="KDS settings"
              className="text-primary hover:bg-surface-container-high transition-colors p-2 rounded-full"
            >
              <MaterialIcon name="settings" size={20} />
            </button>
          </div>
        </header>

        {/* Board */}
        <div className="flex-1 overflow-hidden p-3 grid grid-cols-1 md:grid-cols-3 gap-3">
          {COLUMNS.map((col) => (
            <KdsColumn
              key={col.stage}
              title={col.title}
              badge={col.badge}
              tickets={tickets.filter((t) => t.stage === col.stage)}
              onAdvance={advance}
              advancingIds={advancingIds}
            />
          ))}
        </div>
      </main>

      {/* Settings panel */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className="flex-1 bg-black/40"
            onClick={() => setSettingsOpen(false)}
          />
          {/* Drawer */}
          <aside className="w-80 bg-surface h-full shadow-2xl flex flex-col overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant">
              <h2 className="font-serif text-[18px] font-semibold text-on-surface">
                KDS Settings
              </h2>
              <button
                onClick={() => setSettingsOpen(false)}
                className="p-1.5 rounded-full hover:bg-surface-container-high text-on-surface-variant"
              >
                <MaterialIcon name="close" size={20} />
              </button>
            </div>

            <div className="flex-1 px-5 py-5 space-y-6">
              {/* Station name */}
              <div>
                <label className="block text-[13px] font-semibold text-on-surface-variant mb-1.5">
                  Station name
                </label>
                <input
                  value={stationDraft}
                  onChange={(e) => setStationDraft(e.target.value)}
                  placeholder="e.g. Main Kitchen · Station 01"
                  className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-2.5 text-[14px] text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
                <p className="text-[11px] text-on-surface-variant/60 mt-1">
                  Shown in the header. Saved in this browser.
                </p>
              </div>

              {/* Connection status */}
              <div>
                <p className="text-[13px] font-semibold text-on-surface-variant mb-2">
                  Connection
                </p>
                <div className="rounded-xl border border-outline-variant bg-surface-container-lowest divide-y divide-outline-variant/50">
                  <div className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-[13px] font-medium text-on-surface">API stream</p>
                      <p className="text-[11px] text-on-surface-variant">
                        Order events · tickets · status
                      </p>
                    </div>
                    <span
                      className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${
                        connected
                          ? "bg-tertiary/10 text-tertiary"
                          : "bg-error/10 text-error"
                      }`}
                    >
                      {connected ? "Live" : "Connecting…"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-[13px] font-medium text-on-surface">KDS relay</p>
                      <p className="text-[11px] text-on-surface-variant">
                        Optional · faster stage updates
                      </p>
                    </div>
                    <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-surface-container text-on-surface-variant">
                      Supplementary
                    </span>
                  </div>
                </div>
                <p className="text-[11px] text-on-surface-variant/60 mt-2">
                  The board works fully via the API stream. The relay speeds up
                  live stage advances when it's running on port 4001.
                </p>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-outline-variant">
              <button
                onClick={saveSettings}
                className="w-full bg-primary text-on-primary font-semibold py-3 rounded-full text-[14px] hover:opacity-90 active:scale-[0.98] transition-all"
              >
                Save
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
