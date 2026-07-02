import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { kotSchema, printerSettingsSchema } from "@amber/domain";
import { requireAgentSecret } from "../auth.js";
import { handlePrint } from "../handlePrint.js";
import { renderKot } from "../printer/renderKot.js";

const kotBodySchema = z.object({
  connection: printerSettingsSchema,
  kot: kotSchema,
});

export const kotRouter = Router();

/** Kitchen Order Ticket — a second, simpler print path alongside /print,
 *  typically pointed at a separate kitchen printer (Tenant.kitchenPrinter). */
kotRouter.post("/print/kot", requireAgentSecret, async (req: Request, res: Response) => {
  const parsed = kotBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid request body" });
    return;
  }
  await handlePrint(res, parsed.data.connection, (printer) => renderKot(printer, parsed.data.kot));
});
