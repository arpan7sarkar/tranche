# Tranche

### Clear milestones. Confident payments.

Tranche is an AI-powered workspace for freelancers and agencies that turns client briefs into actionable plans, verifies milestone deliveries, and manages milestone payments through PayPal, with human approval gates and a clear audit trail.

## The Problem

Freelancers juggle briefs, schedules, client feedback, delivery checks, and payments across disconnected tools. Ambiguous scope creates disputes, while manual follow-ups take time away from delivering work.

## The Solution

Tranche brings the project lifecycle into one workspace:

1. Describe the work: Submit a client brief.
2. Review the AI plan: Inspect proposed milestones, deliverables, timelines, and budgets.
3. Schedule execution: Organize tasks and dependencies in an interactive Gantt chart.
4. Align with the client: Review proposals through a client portal and negotiation room.
5. Verify delivery: Check submitted work against milestone requirements.
6. Approve payment: Release eligible milestone payments through PayPal.
7. Track progress: Monitor cash flow, decisions, and project activity.

## Key Features

- AI-generated project plans: Convert briefs into structured, reviewable milestones.
- Interactive scheduling: Visualize tasks, dependencies, and deadlines.
- Negotiation room: Review agent activity, transcripts, and requests for human decisions.
- Client portal: Give clients a dedicated place to review plans and approve releases.
- Delivery verification: Combine machine checks with AI assessment.
- PayPal milestone payments: Connect payment actions to project progress and approval rules.
- Cash-flow dashboard: Track held funds, released payments, and forecasts.
- AI dashboard assistant: Ask questions about available project and financial data.
- Audit trail: Keep project decisions and payment activity traceable.

## Human Control by Design

AI agents propose actions; they do not directly move money. A deterministic policy engine evaluates payment proposals, and PayPal writes run through a dedicated execution pipeline.

Machine checks gate delivery verification. AI assessments cannot override failed checks, and approval gates keep people involved in consequential decisions.

## PayPal Integration

Tranche uses PayPal to authorize and capture milestone payments within its approval workflow.

The hackathon demonstration uses PayPal Sandbox and includes a completed USD 1.00 milestone payment following delivery verification and client release.

## Technology

| Layer | Technology |
|---|---|
| Web application | Next.js, TypeScript |
| AI | Gemini, Vercel AI SDK |
| Workflows | Render Workflows |
| Database | PostgreSQL, Drizzle |
| Scheduling | Bryntum Gantt |
| Dashboard | AG Grid Studio |
| Payments | PayPal Sandbox |
| Workspace | pnpm, Turborepo |

## Who It Is For

Freelancers and small agencies who want clearer project scope, structured client approvals, and milestone-based payments in one place.

Tranche connects the work you promise, the work you deliver, and the payments you receive.