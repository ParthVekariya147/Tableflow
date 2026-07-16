import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { printerSettingsSchema, receiptSchema } from "@amber/domain";
import { requireAgentSecret } from "../auth.js";
import { handlePrint, handleRawPrint } from "../handlePrint.js";
import { renderReceipt } from "../printer/render.js";
import {
  renderTsplReceipt,
  renderTsplTest,
  shouldUseTspl,
} from "../printer/renderTspl.js";

const printBodySchema = z.object({
  connection: printerSettingsSchema,
  receipt: receiptSchema,
});
const testBodySchema = z.object({
  connection: printerSettingsSchema,
});

export const printRouter = Router();

printRouter.post(
  "/print",
  requireAgentSecret,
  async (req: Request, res: Response) => {
    const parsed = printBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: "Invalid request body" });
      return;
    }
    if (shouldUseTspl(parsed.data.connection)) {
      await handleRawPrint(res, parsed.data.connection, (settings) =>
        renderTsplReceipt(settings, parsed.data.receipt),
      );
      return;
    }
    await handlePrint(res, parsed.data.connection, (printer) =>
      renderReceipt(printer, parsed.data.receipt),
    );
  },
);

printRouter.post(
  "/print/test",
  requireAgentSecret,
  async (req: Request, res: Response) => {
    const parsed = testBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: "Invalid request body" });
      return;
    }
    if (shouldUseTspl(parsed.data.connection)) {
      await handleRawPrint(res, parsed.data.connection, renderTsplTest);
      return;
    }
    await handlePrint(res, parsed.data.connection, (printer) => {
      printer.alignCenter();
      printer.bold(true);
      printer.println("Test Print");
      printer.bold(false);
      printer.println(new Date().toLocaleString());
      printer.cut();
    });
  },
);
