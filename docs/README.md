# Crucible AI documentation

## Start here

| Document | Read it for |
|---|---|
| **[TECHNICAL_REPORT.md](TECHNICAL_REPORT.md)** | The whole system: architecture, models, evaluation, performance, limitations |
| **[DECISION_OPERATING_MODEL.md](DECISION_OPERATING_MODEL.md)** | How a condition becomes a decision, and what Crucible AI refuses to do |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Process topology, routers, data platform |

## Reference

| Document | Contents |
|---|---|
| [RBAC.md](RBAC.md) | Roles, mine-level isolation, approval authority, audit |
| [LEARNING_LIFECYCLE.md](LEARNING_LIFECYCLE.md) | Model training governance and the decision learning loop |
| [DATA_HUB.md](DATA_HUB.md) | Dataset upload, column mapping, validation |
| [ENVIRONMENT.md](ENVIRONMENT.md) | Environment variables and local setup |
| [SYNTHETIC_DATA_POLICY.md](SYNTHETIC_DATA_POLICY.md) | What may and may not be claimed from synthetic data |

## Rebuild record

| Document | Contents |
|---|---|
| [AUDIT_FINDINGS.md](AUDIT_FINDINGS.md) | Every defect found in the pre-rebuild code and the live database, with evidence |
| [REBUILD_PLAN.md](REBUILD_PLAN.md) | The 14-phase plan the rebuild followed |

## Before quoting anything

Three caveats govern every number in this documentation set:

1. **All data is synthetic.** No accuracy figure transfers to a real mine.
2. **`leakage_status: PASS` is a hardcoded literal** in the training scripts, not
   a computed result — see [TECHNICAL_REPORT.md §4.5](TECHNICAL_REPORT.md).
3. **Crucible AI is decision support.** It does not perform, dispatch, approve or
   execute operational actions.

## Superseded planning documents

Pre-Crucible AI planning documents (they describe a product called MANGANESIS and
contain no Crucible AI references) have been moved out of the active docs tree to:

```
v8/unused/v3-crucible-unused/docs-archive/
```

Nothing there describes the current system. They are kept rather than deleted
because this repository has no commit history — v1 does, at
`v8/unused/v1-SIH26009-MN`, 89 commits.

Contents: `Architecture(2).md`, `system%20Design.md`, `MVP20Doc.md`,
`PRD(3).md`, `Crucible_UI_Design_Specification.md`, and `specs/` (12 files).
