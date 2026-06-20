import { createHttpKdsTransport } from "@amber/api-client";

/**
 * The guest app's link to the kitchen. "Bring it" / "Bring these" publish rounds
 * through this transport; the KDS subscribes to the same relay and shows them
 * live. Swap the baseUrl (or the transport) for the real backend later — no
 * screen code changes.
 */
const baseUrl = import.meta.env.VITE_KDS_URL ?? "http://localhost:4001";

export const kitchen = createHttpKdsTransport({ baseUrl });
