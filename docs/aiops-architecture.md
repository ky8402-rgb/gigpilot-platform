# Autonomous AIOps Architecture & Implementation Map

## 1. Executive Summary & Philosophy
This document establishes the architecture for the Autonomous AIOps Control Plane within the application. The system operates on a fundamental division of responsibilities:
- **LLM**: Understanding, entity extraction, intent proposal, and plan generation.
- **ML / Predictive AIOps**: Empirical anomaly detection, issue classification, failure prediction, and remediation recommendation based on telemetry.
- **Policy Engine**: Rigid authorization, RBAC, destructive command blocking, and risk controls.
- **Tool Registry**: Whitelist of certified, typed backend capabilities.
- **Execution Engine**: Ordered, idempotent step execution with dependency graph, timeouts, and retry policies.
- **Verification Engine**: Post-action empirical verification against real database, API, and queue states.
- **Audit & Observability**: Immutable structured event logging with credential redaction and correlation IDs.
- **Continuous Learning Loop**: Feedback collection, model candidate training, evaluation gates, shadow validation, promotion, and rollback.

---

## 2. Current Architecture vs. Proposed AIOps Architecture

### Current Architecture
- **Frontend**: React 18 SPA (Vite + Tailwind CSS + Lucide Icons), real-time SSE streaming listeners, AIOps Control Center tab, Freelancer integration cards, System Telemetry cards, Incident logs.
- **Backend API**: Express.js server on port 3000 (`server.ts`), modular routes (`aiRoutes.ts`, `devopsActionsRoutes.ts`, `githubRoutes.ts`, etc.).
- **Data Layer**: Neon PostgreSQL Serverless (`server/db.ts`), Prisma ORM schema (`prisma/schema.prisma`), Redis/Bull queue stubs (`server/asyncQueue.ts`, `server/freelancerRetryQueue.ts`).
- **External Integrations**: Freelancer API (`server/freelancerApi.ts`), PayPal REST API (`server/paypal.ts`), GitHub API (`server/githubService.ts`), Cloudflare/GoDaddy DNS.
- **AI/ML Layer**: Gemini SDK client (`server/gemini.ts`), In-memory statistical predictive models in `server/aiops/` (`classifier.ts`, `predictor.ts`, `anomalyDetector.ts`, `remediationSelector.ts`, `training.ts`).

### Proposed AIOps Architecture
- **Contracts & Schemas (`server/ai/schemas.ts`)**: Zod-validated schemas for `AIIntent`, `SystemState`, `AITool`, `ExecutionStep`, `VerificationResult`, `AuditEvent`, `RemediationPolicy`, `MLInference`, `MLFeedback`.
- **Tool Registry (`server/tools/`)**: 16 strongly typed tools across database, freelancer, queue, work order, paypal, system, and MLOps domains.
- **Policy Engine (`server/ai/policy.ts`)**: Whitelist enforcement, prompt injection detection, risk grading, and human approval gates.
- **System State & Context (`server/ai/context.ts`)**: Verified application state snapshot gathering live DB, queues, Freelancer API, PayPal, work orders, telemetry, and model registry data.
- **Orchestrator & Agent (`server/ai/agent.ts`)**: Manages the end-to-end flow: Understanding → Diagnosing → Planning → Authorization → Executing → Verifying → Auditing → ML Feedback.
- **Verification Engine (`server/ai/verifier.ts`)**: Multi-check empirical verification ensuring the system never claims "Fixed" without physical proof.
- **Audit Store (`server/ai/auditStore.ts`)**: Immutable ring buffer of audit events with credential redaction.
- **Real-Time Event Bus (`server/events/eventBus.ts`)**: Publish-subscribe bus delivering Server-Sent Events (SSE) directly to the frontend.

---

## 3. Dependency Map & Data Flow

```
[ Natural Language User Command ]
               │
               ▼
      [ AIAgent (server/ai/agent.ts) ]
               │
      ┌────────┴───────────────────────────────────────────────────────┐
      │ 1. Safety Check (Prompt Injection Defense)                     │
      │ 2. System State & Context (server/ai/context.ts)               │
      │ 3. ML Issue Classification & Prediction (server/aiops/)        │
      │ 4. Intent Classification (server/ai/schemas.ts)                │
      │ 5. AI Plan Generation (server/ai/planner.ts)                   │
      │ 6. Policy Check & Approval (server/ai/policy.ts)               │
      └────────┬───────────────────────────────────────────────────────┘
               ▼
[ Plan Executor (server/ai/executor.ts) ] ◄── Uses Tool Registry (server/tools/)
               │
               ├─► verify_freelancer_api / restart_scraper / sync_freelancer_jobs
               ├─► verify_postgres / repair_postgres_pool
               ├─► inspect_queue / retry_failed_jobs
               └─► run_health_check / create_incident
               │
               ▼
[ Verification Engine (server/ai/verifier.ts) ]
               │
      ┌────────┴───────────────────────────────────────────────────────┐
      │ - Check Subsystem Health (API ping, DB ping, queue counts)     │
      │ - Empirical Telemetry Before vs After Comparison               │
      │ - Status: PASSED / PARTIAL / FAILED / INCONCLUSIVE             │
      └────────┬───────────────────────────────────────────────────────┘
               │
               ├─► [ Audit Store (server/ai/auditStore.ts) ]
               ├─► [ ML Feedback Pipeline (server/aiops/training.ts) ]
               ├─► [ Event Bus / SSE (server/events/eventBus.ts) ]
               ▼
   [ Final Verified Outcome ] ──► [ Frontend Chat & Real-Time Dashboard ]
```

---

## 4. Implementation Mapping

| Existing Component | AIOps Role / Target | File Involved | Status |
|--------------------|---------------------|---------------|--------|
| `server/aiops/types.ts` | Type definitions for telemetry & ML | `server/aiops/types.ts` | Upgraded & Synchronized |
| `server/ai/schemas.ts` | Strict Zod contracts & schemas | `server/ai/schemas.ts` | Implemented & Validated |
| `server/tools/` | Capable, constrained Tool Registry | `server/tools/index.ts`, `*Tools.ts` | Implemented (16 tools) |
| `server/ai/context.ts` | Live SystemState gatherer | `server/ai/context.ts` | Implemented & Schema-checked |
| `server/ai/policy.ts` | RBAC & Risk authorization engine | `server/ai/policy.ts` | Implemented & Enforcing |
| `server/ai/planner.ts` | Intent & Plan generation | `server/ai/planner.ts` | Implemented with Zod validation |
| `server/ai/executor.ts` | Safe step runner with dependencies | `server/ai/executor.ts` | Implemented with idempotency |
| `server/ai/verifier.ts` | Empirical result verification | `server/ai/verifier.ts` | Implemented with empirical telemetry |
| `server/ai/auditStore.ts` | Immutable audit log & redaction | `server/ai/auditStore.ts` | Implemented |
| `server/aiops/training.ts`| ML candidate training & gates | `server/aiops/training.ts` | Implemented |
| `server/events/eventBus.ts`| Live SSE event stream | `server/events/eventBus.ts` | Implemented |
| `server/aiRoutes.ts` | AIOps REST & SSE endpoints | `server/aiRoutes.ts` | Implemented |
| `src/components/AIOpsChat.tsx` | Frontend Chat & State Stream | `src/components/AIOpsChat.tsx` | Integrated with `/api/ai/chat/stream` |
