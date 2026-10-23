import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { httpError } from "./helpers.js";
import { aiUsageReport } from "../db/aiCalls.js";

// The signed-in user's own account data.

export const meRouter = Router();

const MAX_DAYS = 90;

// ?days=1-90 (default 30) → the user's AI calls: totals, per tier, per feature, per day, latest failures.
meRouter.get(
  "/ai-usage",
  asyncHandler(async (req, res) => {
    const days = req.query.days === undefined ? 30 : Number(req.query.days);
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) throw httpError(400, `days must be a whole number from 1 to ${MAX_DAYS}.`);
    res.json(await aiUsageReport(req.user.id, days, req.tz));
  })
);
