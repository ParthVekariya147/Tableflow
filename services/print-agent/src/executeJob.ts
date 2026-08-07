import type { PrintJob, PrintJobResult } from "@amber/domain";
import { runPrint, runRawPrint } from "./printer/execute.js";
import { renderReceipt } from "./printer/render.js";
import { renderKot } from "./printer/renderKot.js";
import {
  renderTsplKot,
  renderTsplReceipt,
  renderTsplTest,
  shouldUseTspl,
} from "./printer/renderTspl.js";

/**
 * Runs one relayed job. Branches exactly like the local HTTP routes — same
 * TSPL-vs-ESC/POS decision, same renderers — so output does not depend on
 * which transport the job arrived over.
 */
export async function executeJob(job: PrintJob): Promise<PrintJobResult> {
  const { connection } = job;
  const tspl = shouldUseTspl(connection);

  const outcome = await (async () => {
    switch (job.kind) {
      case "receipt":
        return tspl
          ? runRawPrint(connection, (settings) =>
              renderTsplReceipt(settings, job.receipt!),
            )
          : runPrint(connection, (printer) =>
              renderReceipt(printer, job.receipt!),
            );
      case "kot":
        return tspl
          ? runRawPrint(connection, (settings) =>
              renderTsplKot(settings, job.kot!),
            )
          : runPrint(connection, (printer) => renderKot(printer, job.kot!));
      case "test":
        return tspl
          ? runRawPrint(connection, renderTsplTest)
          : runPrint(connection, (printer) => {
              printer.alignCenter();
              printer.bold(true);
              printer.println("Test Print");
              printer.bold(false);
              printer.println(new Date().toLocaleString());
              printer.cut();
            });
    }
  })();

  return {
    jobId: job.jobId,
    ok: outcome.ok,
    reason: outcome.reason,
    error: outcome.error,
  };
}
