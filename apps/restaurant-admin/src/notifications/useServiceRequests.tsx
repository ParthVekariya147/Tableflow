import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ServiceRequest } from "@amber/domain";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { playServiceRequestChime } from "./sound";

const MUTE_KEY = "amber-admin-service-request-mute";

interface ServiceRequestsContextValue {
  /** Open requests (pending + acknowledged), newest first. */
  requests: ServiceRequest[];
  /** Count still awaiting a first look — drives the bell's badge. */
  pendingCount: number;
  acknowledge: (id: string) => Promise<void>;
  resolve: (id: string) => Promise<void>;
  /** Whether the new-request chime is silenced (persisted across sessions). */
  muted: boolean;
  toggleMuted: () => void;
}

const ServiceRequestsContext = createContext<ServiceRequestsContextValue | null>(null);

/**
 * Live guest service requests (water / call staff / call manager) — a
 * notification channel fully separate from AdminStore's Order/floor data.
 * Subscribes to /service-requests/stream via the shared `api` client (same
 * one OrderHistoryPage etc. use directly), gated on being signed in.
 */
export function ServiceRequestsProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      return false;
    }
  });
  // Read inside the stream handler without forcing a re-subscribe (a fresh
  // EventSource + snapshot) every time the mute toggle flips.
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  useEffect(() => {
    if (status !== "authed") {
      setRequests([]);
      return;
    }
    const unsub = api.serviceRequests.stream((event) => {
      if (event.type === "snapshot") {
        // Seeds the board on (re)connect — never chimes; a reconnect isn't a
        // new request.
        setRequests(event.requests);
      } else if (event.type === "created") {
        setRequests((prev) => [
          event.request,
          ...prev.filter((r) => r.id !== event.request.id),
        ]);
        if (!mutedRef.current) playServiceRequestChime();
      } else {
        // "updated" — resolved requests drop off the open list; anything
        // else (e.g. acknowledged) replaces the existing row in place.
        setRequests((prev) =>
          event.request.status === "resolved"
            ? prev.filter((r) => r.id !== event.request.id)
            : prev.map((r) => (r.id === event.request.id ? event.request : r)),
        );
      }
    });
    return unsub;
  }, [status]);

  const toggleMuted = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(MUTE_KEY, next ? "1" : "0");
      } catch {
        /* storage unavailable — in-memory only for this tab */
      }
      return next;
    });
  }, []);

  const acknowledge = useCallback(async (id: string) => {
    await api.serviceRequests.updateStatus(id, "acknowledged");
  }, []);

  const resolve = useCallback(async (id: string) => {
    await api.serviceRequests.updateStatus(id, "resolved");
  }, []);

  const pendingCount = useMemo(
    () => requests.filter((r) => r.status === "pending").length,
    [requests],
  );

  const value = useMemo(
    () => ({ requests, pendingCount, acknowledge, resolve, muted, toggleMuted }),
    [requests, pendingCount, acknowledge, resolve, muted, toggleMuted],
  );

  return (
    <ServiceRequestsContext.Provider value={value}>
      {children}
    </ServiceRequestsContext.Provider>
  );
}

export function useServiceRequests(): ServiceRequestsContextValue {
  const ctx = useContext(ServiceRequestsContext);
  if (!ctx)
    throw new Error("useServiceRequests must be used within a ServiceRequestsProvider");
  return ctx;
}
