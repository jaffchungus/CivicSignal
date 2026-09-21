# CivicSignal PRD Index

Status: Product requirements required before functional decomposition

## Current documents

| Document | Purpose | Priority | Dependencies | Recommended order |
|---|---|---:|---|---:|
| [00-project-context.md](./00-project-context.md) | Records repository evidence, implementation state, and the missing product baseline | MVP prerequisite | None | 1 |
| [01-architecture.md](./01-architecture.md) | Records the architecture baseline, unresolved boundaries, and architecture-readiness criteria | MVP prerequisite | `00-project-context.md` | 2 |
| [DECISIONS.md](./DECISIONS.md) | Records cross-cutting decisions and unresolved decisions without inventing facts | MVP prerequisite | `00-project-context.md` | Read throughout |
| [PRD-CONSISTENCY-REVIEW.md](./PRD-CONSISTENCY-REVIEW.md) | Reviews the current specification set for conflicts, omissions, and readiness | Quality gate | All PRD documents | Last |

## Functional PRDs

No functional PRDs are currently listed. The repository does not define any functional subsystem, actor, workflow, entity, or product outcome that can be specified without invention.

This is intentional under decision D-003, not an assertion that the finished product has no features.

## Required next specification order

After authoritative product requirements are added, revise the PRD set in this order:

1. Update `00-project-context.md` with the product problem, actors, requirements sources, implemented state, and planned state.
2. Resolve relevant entries in `DECISIONS.md`, recording rationale and affected documents.
3. Update `01-architecture.md` with only the components and boundaries required by the approved product scope.
4. Define the domain terminology and canonical entities once, in the earliest document that owns them.
5. Create functional PRDs in dependency order, beginning with foundational identity/data capabilities only if the documented workflows require them.
6. Add each functional PRD to this index with its purpose, priority, dependencies, and implementation order.
7. Repeat the consistency review and resolve all straightforward conflicts before authorizing implementation.

The number and names of future functional PRDs must be determined from the actual product seams. They must not be preallocated from the repository name.

