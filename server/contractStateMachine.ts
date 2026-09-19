import { prisma } from "./db.js";

export const CONTRACT_STATES = [
  "DISCOVERED",
  "QUALIFIED",
  "PROPOSAL_READY",
  "BID_SUBMITTED",
  "AWARDED",
  "ACCEPTED",
  "FUNDED",
  "EXECUTING",
  "QUALITY_VERIFIED",
  "DELIVERED",
  "CLIENT_APPROVED",
  "SETTLEMENT_PENDING",
  "PROVIDER_CONFIRMED",
  "SETTLED",
  "BLOCKED",
] as const;

export type ContractState = typeof CONTRACT_STATES[number];

const terminalStates = new Set<ContractState>(["SETTLED"]);
const stateOrder: ContractState[] = [...CONTRACT_STATES];

function deriveContractState(order: any): ContractState {
  if (order.escrowStatus === "SETTLED" || order.status === "COMPLETED" && order.escrowStatus === "RELEASED") return "SETTLED";
  if (order.escrowStatus === "RELEASE_PENDING" || order.milestoneStatus === "RELEASE_PENDING") return "SETTLEMENT_PENDING";
  if (order.escrowStatus === "RELEASED" || order.escrowStatus === "PROVIDER_CONFIRMED") return "PROVIDER_CONFIRMED";
  if (order.clientApprovedAt || order.milestoneStatus === "APPROVED") return "CLIENT_APPROVED";
  if (order.deliveryStatus === "PROVIDER_DELIVERED") return "DELIVERED";
  if (order.deliveryStatus === "READY_FOR_PROVIDER_DELIVERY") return "QUALITY_VERIFIED";
  if (order.status === "IN_PROGRESS" && order.fundedAt) return "EXECUTING";
  if (order.fundedAt || order.escrowStatus === "FUNDED") return "FUNDED";
  if (order.externalAcceptanceVerified) return "ACCEPTED";
  if (order.externalBidId) return "BID_SUBMITTED";
  if (order.externalProjectId) return "AWARDED";
  return "DISCOVERED";
}

export function getContractState(order: any): ContractState {
  return deriveContractState(order);
}

export function canTransition(from: ContractState, to: ContractState): boolean {
  if (from === to) return true;
  if (terminalStates.has(from)) return false;
  if (to === "BLOCKED") return true;
  if (from === "BLOCKED") return to !== "DISCOVERED";
  const fromIndex = stateOrder.indexOf(from);
  const toIndex = stateOrder.indexOf(to);
  return fromIndex >= 0 && toIndex === fromIndex + 1;
}

export async function getContractOperations(limit = 50) {
  const orders = await prisma.workOrder.findMany({
    orderBy: { updatedAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
    include: { milestones: true, escrowLedger: true },
  });

  return orders.map((order) => {
    const state = deriveContractState(order);
    const blockingReasons: string[] = [];
    if (state === "BID_SUBMITTED" && !order.externalAcceptanceVerified) blockingReasons.push("Awaiting provider acceptance");
    if (state === "EXECUTING" && order.deliveryStatus !== "READY_FOR_PROVIDER_DELIVERY") blockingReasons.push("Deliverable not quality-verified");
    if (state === "QUALITY_VERIFIED" && !order.externalAcceptanceVerified) blockingReasons.push("Provider acceptance missing");
    if (state === "DELIVERED" && !order.clientApprovedAt) blockingReasons.push("Client approval pending");
    if (state === "SETTLEMENT_PENDING" && order.escrowStatus !== "SETTLED") blockingReasons.push("Provider settlement confirmation pending");

    return {
      id: order.id,
      title: order.title,
      clientName: order.clientName,
      platform: order.platform,
      amount: order.amount,
      currency: order.currency,
      state,
      stateOrder: stateOrder.indexOf(state),
      blockingReasons,
      updatedAt: order.updatedAt,
      dueDate: order.dueDate,
      fundedAt: order.fundedAt,
      clientApprovedAt: order.clientApprovedAt,
      deliveryStatus: order.deliveryStatus,
      escrowStatus: order.escrowStatus,
      externalProvider: order.externalProvider,
      externalProjectId: order.externalProjectId,
      externalBidId: order.externalBidId,
      externalAcceptanceVerified: order.externalAcceptanceVerified,
    };
  });
}

export async function getContractOperationsSummary() {
  const operations = await getContractOperations(100);
  const byState = Object.fromEntries(CONTRACT_STATES.map((state) => [state, 0])) as Record<ContractState, number>;
  for (const operation of operations) byState[operation.state] += 1;

  const blocked = operations.filter((operation) => operation.blockingReasons.length > 0);
  const staleThreshold = Date.now() - 6 * 60 * 60 * 1000;
  const stalled = operations.filter((operation) => {
    const active = !["SETTLED", "BLOCKED"].includes(operation.state);
    return active && new Date(operation.updatedAt).getTime() < staleThreshold;
  });

  return {
    generatedAt: new Date().toISOString(),
    totalContracts: operations.length,
    activeContracts: operations.filter((o) => !["SETTLED", "BLOCKED"].includes(o.state)).length,
    settledContracts: byState.SETTLED,
    blockedContracts: blocked.length,
    stalledContracts: stalled.length,
    byState,
    operations,
  };
}
