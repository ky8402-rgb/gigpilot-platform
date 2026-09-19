import { Router } from "express";
import { getContractOperationsSummary } from "../server/contractStateMachine.js";

export const contractOperationsRouter = Router();

contractOperationsRouter.get("/summary", async (_req, res) => {
  try {
    const summary = await getContractOperationsSummary();
    res.json({ success: true, ...summary });
  } catch (error: any) {
    console.error("[ContractOperations] summary failed:", error);
    res.status(500).json({ success: false, error: "CONTRACT_OPERATIONS_UNAVAILABLE" });
  }
});
