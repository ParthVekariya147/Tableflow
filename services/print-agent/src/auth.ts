import type { NextFunction, Request, Response } from "express";

/**
 * Guards /print and /print/test with a shared secret sent as `X-Agent-Secret`.
 * If AGENT_SECRET isn't set in the environment, the agent runs in OPEN MODE —
 * acceptable only when the agent and printer never leave the same PC as the
 * browser (Settings → Printer warns the operator about this tradeoff). Never
 * applied to /health, which returns no receipt data and must work before a
 * secret is configured on either side.
 */
export function requireAgentSecret(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.AGENT_SECRET;
  if (!expected) {
    next();
    return;
  }
  if (req.header("x-agent-secret") !== expected) {
    res.status(401).json({ success: false, error: "Missing or invalid X-Agent-Secret header" });
    return;
  }
  next();
}
