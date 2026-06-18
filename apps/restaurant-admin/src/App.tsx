import { MaterialIcon } from "@amber/ui";

/**
 * Restaurant Admin shell — Kitchen Display System + menu/table management.
 *
 * Design spec: ./DESIGN.md and ./kds.html (in this app folder).
 * Build-out plan:
 *  - Connect to @amber/api-client; poll/subscribe to open Orders for the
 *    staff's tenant and render the KDS column board (DESIGN.md).
 *  - Advance item status (placed -> preparing -> served) via the orders API.
 *  - Menu & table CRUD screens.
 *  - Wrap in <TenantThemeProvider> with the staff member's tenant so the admin
 *    adopts that restaurant's brand, exactly like the customer app.
 */
export default function App() {
  return (
    <div className="min-h-screen bg-background text-on-surface p-8">
      <header className="flex items-center gap-3 mb-6">
        <MaterialIcon name="skillet" filled size={28} className="text-primary" />
        <h1 className="text-2xl font-serif font-bold">Kitchen Display</h1>
      </header>
      <p className="text-on-surface-variant max-w-prose">
        KDS scaffold. Wire to <code>@amber/api-client</code> and render the
        column board from <code>DESIGN.md</code>. Themed through the same tenant
        tokens as every other app.
      </p>
    </div>
  );
}
