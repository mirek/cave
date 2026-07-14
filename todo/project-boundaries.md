---
name: project-boundaries
description: Preserve the permanent non-goals that keep CAVE local and small.
status: constraint
priority: none
area: project
source: retired-roadmap-19.5
---

# Project boundaries

CAVE does not intend to become a multi-tenant access-control framework, organization/workspace/project hierarchy, app builder, analytics suite, hosted service, distributed compute engine, model catalog, read-side audit logger, or Kubernetes platform.

Staying small is part of the product. Every capability must remain runnable offline, on one machine, over one SQLite file, with plain text as the escape hatch. New core syntax requires semantic need; declarations stay in-band, executable integrations stay out-of-band, storage stays append-oriented, and the agent remains outside the language.
