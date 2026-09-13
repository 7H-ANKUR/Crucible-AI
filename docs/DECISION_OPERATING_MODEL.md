# Crucible AI — Decision Operating Model

How Crucible AI turns an operational condition into a decision someone can be
accountable for, and what it refuses to do along the way.

```
DETECT → UNDERSTAND → DECIDE → SIMULATE → APPROVE → ACT → MEASURE → LEARN
```

---

## 1. The loop

| Stage | Question | Module | Surface |
|---|---|---|---|
| Detect | What is happening? | `core/state_engine.py` | Operational state |
| Understand | Why, and how serious? | `core/bottleneck.py`, `core/attention.py` | Attention queue |
| Decide | What can we do? | `core/recommendations.py` | Recommended actions |
| Simulate | What if we do it? What if we don't? | `core/scenario/`, `core/projection.py` | Option comparison |
| Approve | Who signs this off? | `core/decision_store.py` | Response plan |
| Act | Who does what, and when? | `gov.response_plan_actions` | Plan actions |
| Measure | Did it work? | `gov.decision_outcomes` | Predicted vs actual |
| Learn | What do we know now? | `core/decision_memory.py` | What happened last time |

Each stage consumes the previous stage's output. Nothing on a Crucible AI screen is
computed twice by two different code paths — that was the defect this
architecture replaced.

---

## 2. Operational state

`mine_state()` returns one of **NORMAL / WATCH / DISRUPTION / CRITICAL /
UNKNOWN**, derived from five independent signals:

| Signal | Source | Thresholds |
|---|---|---|
| `production_gap` | `ops.production_records`, last 5 shifts | 5% watch, 12% disruption, 25% critical |
| `equipment_risk` | `ops.equipment_telemetry`, latest per machine | 35% of fleet watch, 55% disruption |
| `maintenance_overdue` | `ops.equipment_telemetry` | 7 days watch, 21 days disruption |
| `bottleneck` | `core/bottleneck.py` | 85% constrained, 95% saturated |
| `open_incidents` | `ops.incidents` | any open |

**State is the worst severity present, not an average.** Averaging lets four
healthy signals bury one critical one, which is the failure mode of a composite
score. A mine cannot be "82% operational".

**UNKNOWN is distinct from NORMAL.** A mine nobody is measuring is not a healthy
mine.

### Scope separation

`platform_state()` is returned separately and covers data freshness and model
serving integrity. Stale telemetry is a platform problem, not a mining one.
Merging them would make a mine with a broken feed look like a mine in trouble,
and would let good data hygiene mask a real production problem.

---

## 3. Evidence quality

Crucible AI does not emit confidence percentages. It previously did, and the value was
`85.0 if baseline_backed else 60.0` — a two-branch constant wearing the costume
of a calibrated probability.

`core/evidence.py` grades **support** — HIGH / MEDIUM / LOW / UNAVAILABLE — from
five measured factors:

| Factor | Measured from | Weight |
|---|---|---|
| Data freshness | age of the newest observation | 1.4 |
| Feature completeness | fraction of model features genuinely present | 1.2 |
| Model availability | champion serving, and in sync | 1.5 |
| Historical support | count of comparable past observations | 0.8 |
| Constraint coverage | fraction of applicable constraints actually evaluated | 1.3 |

The grade is **capped, not averaged**, by factors that can independently ruin an
answer. No model serving caps the grade at LOW however fresh the data is;
day-old data caps it at LOW however complete the features are.

Support is a claim about *inputs*, which is checkable. It is not a claim about
accuracy, which would not be.

**Calibrated model probabilities keep their numeric form** — see
`ShortfallRiskInfo.probability`. The rule is: a percentage appears only when a
model produced it.

---

## 4. Calculation mode

Every operational number carries one of:

| Mode | Meaning |
|---|---|
| `MODEL_BACKED` | Produced by a serving champion model |
| `HEURISTIC` | A declared estimate, stated as such |
| `INSUFFICIENT_DATA` | Not computed — the platform declined to guess |

`INSUFFICIENT_DATA` is a **first-class outcome, not an error**. It means the
platform could have produced a plausible number and chose not to. Callers render
it as an absence and never substitute a default.

A fabricated zero reads as a measurement. In an operational context that is
worse than a blank, because a blank prompts a question and a number ends one.

---

## 5. Scenario semantics

### Production gap is not a probability

The field formerly called `shortfall_prob` held `(plan − production) / plan` —
a production gap ratio — and the UI rendered it as "Shortfall Risk 6.8%".

Two different signals, now separately named:

| Field | Meaning | Source |
|---|---|---|
| `production_gap_t` / `production_gap_pct` | Planned minus expected | Arithmetic on records |
| `probability_of_shortfall` | Calibrated likelihood of missing target | Shortfall classifier |

They are never merged.

### How an intervention's effect is obtained

1. **Model counterfactual.** Move every feature the action genuinely controls by
   the chosen magnitude, re-score with the serving model, take the difference.
   All controlled features move together: a haulage reallocation raises
   availability, utilisation and operating hours at once, and moving one while
   holding the others fixed is not the intervention being offered.

2. **Flat-response detection.** A tree ensemble returns exactly `0.0` when a
   feature move crosses no split boundary. That is a fact about the model, not
   about the mine, so it is reported as *"the model's output is flat to a +10%
   move in …"* and the estimate falls back to the declared effect. Saying "this
   action achieves nothing" would be an overclaim.

3. **Clamping.** A delta beyond ±25% of baseline is extrapolation, not
   prediction, and is clamped with the clamp stated.

### Objectives

`MAXIMIZE_PRODUCTION`, `BALANCED`, `MINIMIZE_COST`, `MINIMIZE_RISK`. Each
produces its own ordering and `winners()` reports the leader under every
objective, so disagreement between them is visible — that is precisely the
moment the choice belongs to the manager rather than the platform.

**Nothing is best in the abstract.** An action is only ever best *for* a stated
objective.

### Cost

Derived from the mine's own `ops.production_records` cost lines — equipment
operating, maintenance, blast, haul, processing — not a flat rate. The previous
model was `abs(delta) × ₹1,200/t`, which made cost proportional to benefit, so
every action had identical return and the cost term could not influence ranking
at all. A manager choosing "minimise cost" was being ranked by production in
disguise.

---

## 6. Constraints

`core/constraints.py` separates two kinds:

| Kind | Behaviour |
|---|---|
| **HARD** | Never violated. Blocks when FAILED **or NOT_EVALUATED**. |
| **SOFT** | Shapes ranking only. Penalty applies only when unsatisfied. |

**A hard constraint that could not be evaluated blocks.** The code this replaced
found no equipment rows, set *"No live data available; assuming typical
availability"*, left the feasibility multiplier at 1.0, and approved a redeploy
on data that did not exist.

Absence of evidence is not evidence of safety.

An action with no registered evaluator is **refused**, not assumed safe. Adding
an action type requires deciding what governs it.

### What is not a constraint

"Rerouting burns fuel" and "deferring maintenance raises exposure" are always
true. They are costs of the action, not questions about whether it is permitted,
and they live in the cost and risk model instead.

---

## 7. Incident and decision lifecycle

```
DRAFT → SIMULATED → READY_FOR_REVIEW → APPROVED → EXECUTING → COMPLETED → MEASURED → LEARNED
                          ↓                ↓
                       REJECTED ←──────────┘
                          ↓
                        DRAFT
```

Enforced by `core/decision_store.TRANSITIONS`. Deliberate choices:

- **REJECTED can return to DRAFT.** A rejection usually means "not like that";
  forcing a new record would sever the history of what was asked.
- **APPROVED can reach REJECTED.** Authorisation can be withdrawn before work starts.
- **Nothing leaves LEARNED.** A superseding decision is a new decision, so the
  record of what was believed at the time stays intact.

`status` is constrained to `lower(lifecycle_state)`. Before migration 002 the two
were independently writable and had drifted: production rows existed marked
`lifecycle_state='RECOMMENDED'` and `status='executed'` simultaneously.

### Audit shares the transaction

The audit write is **not** wrapped in `try/except`. If it cannot be recorded, the
state change does not happen. The routers this replaced used
`except Exception: pass`, so a broken audit log looked identical to a working
one — and the ledger is the only thing that makes a decision reconstructable.

---

## 8. Approval

Each catalogue action declares `approval_roles`. A plan is approved as a whole,
so **the strictest action governs** — otherwise the role model could be bypassed
by bundling a maintenance deferral into a production plan.

A rejection **requires a rationale**. A refusal with no reason cannot inform the
next one.

---

## 9. Outcome measurement

On completion, a person records what actually happened:

```
predicted_t   23.4
actual_t      18.4
delta_t       -5.0
variance_pct  -21.4%
effectiveness 0.786
reason        "Hauler H-03 unavailable for 2 hours."
```

`effectiveness = actual / predicted`, bounded at 1. A result that beat the
prediction is not "160% effective" — it is a prediction that was low, and the
variance already says so.

**Effectiveness measures how well Crucible AI forecast the result, not whether the
decision was good.** That wording is kept everywhere the number appears.

---

## 10. Decision memory

`similar()` answers *"we have been here before — did it work?"*

- **Structural match first** (intervention key), textual second (token overlap),
  each labelled with which was used.
- **Duplicates collapsed** on the full outcome tuple. The seeded history contains
  one decision written 37 times; counted separately it presented as independent
  corroboration and produced "5 measured cases, median 48 t" from a single
  observation.
- **No aggregate below 3 distinct cases.** "Median recovery 3.7%" reads as a
  statistic regardless of whether it came from thirty cases or two.
- Records predating mine scoping are **labelled unscoped**, not attributed to the
  mine being asked about.

---

## 11. Playbooks

A playbook is a site's standing answer to a recurring situation: trigger
conditions, ordered steps, owners, and a pointer to the site's own approved
procedure where one governs.

- **Triggers evaluate against measured signals only.** An `INSUFFICIENT_DATA`
  signal never satisfies a clause — a playbook firing on absence would be an
  alarm with no evidence behind it.
- **Triggers can narrow by stage.** A haulage playbook must not fire when the
  face is the constraint; haulage actions cannot relieve it.
- **Dormant playbooks are returned with their reason.** Without them there is no
  way to distinguish "nothing is wrong" from "the check never ran".
- Built-ins are a **starting point to be edited**, not authority.

---

## 12. Safety boundaries

These hold throughout the codebase and the interface:

1. **Crucible AI recommends; people decide.** No endpoint performs an operational
   action. `/start` records that a person has begun work; it dispatches nothing.
2. **No UI verb implies machine control.** "File for approval", "Record as
   started" — never "deploy" or "execute".
3. **Site procedure is authoritative.** Where a rule encodes regulation, the
   citation is named so it can be reviewed against the site's approved
   procedures. Crucible AI asserts no regulatory authority.
4. **No autonomous emergency claims.** The disruption workflow is decision
   support for authorised personnel.
5. **Missing safety-relevant telemetry blocks, never defaults.**

---

## 13. The operational clock

Crucible AI is developed against a historical benchmark: equipment telemetry ends
2024-10-31, production records end 2025-06-30.

Measuring freshness against the wall clock would mark every observation EXPIRED
in perpetuity — pinning every evidence grade to LOW and making the Command
Center permanently report "no recent telemetry" for a mine whose records are
complete.

`core/clock.py` therefore makes the reference point explicit:

| Mode | Reference | When |
|---|---|---|
| `LIVE` | wall clock | newest observation within 36 hours |
| `BENCHMARK` | dataset epoch | otherwise |
| `UNKNOWN` | wall clock | no dated observations at all |

In BENCHMARK mode every surface showing a freshness value also shows the dataset
epoch. A row is then "live" relative to a *stated* point in time, which is true,
rather than relative to an unstated one, which is not.

---

## 14. What Crucible AI will not do

From the platform's own constraints, not a marketing position:

- Emit a confidence percentage that no model produced
- Substitute a default for missing safety-relevant telemetry
- Return a plausible number where the inputs were absent
- Name a stage "the binding constraint" when it has ample headroom
- Rank an unmeasured problem alongside a measured one
- Approve, dispatch, or execute anything
