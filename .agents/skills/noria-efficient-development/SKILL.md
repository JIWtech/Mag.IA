---
name: noria-efficient-development
description: Efficient, safe development for the NORIA multi-tenant SaaS. Use for React refactoring, frontend CSS, Supabase integrations, WhatsApp/n8n workflows, performance optimization, debugging, architecture changes, and regression prevention in the NORIA repository.
---

# NORIA - Efficient Development

## Mission

Maintain NORIA as a reliable, modular, performant multi-tenant SaaS.

Priorities:
1. Correctness and tenant isolation.
2. Preservation of existing behavior.
3. Maintainable architecture.
4. Efficient context and token usage.
5. Testable incremental changes.

## Context Efficiency

- Identify the task scope before reading files.
- Prefer rg --files, rg -n and targeted searches.
- Never dump entire large files without a clear need.
- Read only relevant functions, components and imports.
- Expand the inspection when dependencies require it.
- Avoid repeatedly reading unchanged code.
- Reuse established findings from the current task.
- Keep progress summaries short and actionable.
- Avoid redundant explanations and massive terminal output.
- Never sacrifice correctness, security or tests to save tokens.

## Repository Architecture

Inspect the actual repository before making assumptions.

Known areas:
- app/src: React frontend.
- n8n/code: WhatsApp conversation logic.
- n8n/workflows: n8n workflow definitions.
- supabase/migrations: database migrations.
- scripts: development and validation tools.

Known large frontend files:
- main.jsx: application logic and components.
- styles.css: legacy global styles.
- conversations.css: redesigned Conversations interface.

Paths and responsibilities may evolve after refactoring.
Always verify the current structure.

## React and Frontend

- Prefer feature-based modularization where appropriate.
- Keep application bootstrap separate from page implementation.
- Separate UI components, hooks and data access when useful.
- Do not create unnecessary abstractions.
- Avoid circular dependencies.
- Preserve existing component contracts and behavior.
- Preserve the redesigned Conversations interface.
- Preserve media, audio, messages, filters and realtime behavior.
- Check CSS specificity, import order and responsive layouts.
- Avoid adding dependencies without justification.

## Multi-Tenant Safety

- Always preserve tenant isolation.
- Never hardcode a tenant ID as a global business rule.
- Load tenant-specific behavior from validated configuration.
- Never mix contacts, appointments, messages or catalogs across tenants.
- Preserve authentication, authorization and RLS assumptions.
- Do not expose privileged credentials to frontend code.
- Do not infer permissions from user-editable metadata.

## Supabase

- Inspect existing schema, functions and migrations first.
- Respect existing API and RPC contracts.
- Validate concurrency and idempotency for booking operations.
- Do not modify production data without explicit authorization.
- Do not run destructive migrations without approval.
- Never rename previously applied migrations casually.
- Verify authorization and RLS implications.

## WhatsApp and n8n

- Preserve node IDs, connections and workflow layout when patching.
- Prefer targeted changes over rebuilding workflows.
- Inspect the current source of truth before modifying generated code.
- Keep code generators and generated runtime consistent.
- Preserve human handoff, message history and delivery guarantees.
- Test duplicate messages and retry behavior.
- Verify appointment availability before promising booking slots.
- Never deploy or activate production workflows automatically.

## Safe Refactoring

Before changes:
1. Inspect git status and existing uncommitted changes.
2. Identify affected files and dependencies.
3. Establish baseline build and tests.
4. Define a small, reversible change.

During changes:
1. Preserve externally visible behavior unless change is requested.
2. Prefer incremental refactoring.
3. Do not rewrite unrelated modules.
4. Do not discard user changes.
5. Review imports and data flows.

After changes:
1. Run relevant tests and build commands.
2. Inspect git diff and check for accidental deletions.
3. Validate affected edge cases.
4. Report changed files, tests, limitations and remaining risks.

Never claim that a passing build proves all business behavior.

## Production Safety

Treat NORIA as a potentially live system.

Do not modify production databases, publish workflows,
deploy applications or perform destructive operations
without explicit authorization.

## Response Style

Be concise but technically precise.

Report:
- What was investigated.
- What changed.
- What was validated.
- What remains unverified.

Do not claim success without evidence.

## Activation

Use this skill for development tasks in the NORIA repository.

Combine it with specialized React, Supabase, n8n and
testing skills when needed. Avoid loading unrelated skills.