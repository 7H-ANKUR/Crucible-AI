"""app/api/core/intent.py — deterministic intent classification for NL queries.

Replaces a chain of `any(keyword in query)` checks whose branches overlapped. The
word **target** appeared in both the production list and the exploration list,
and production was tested first, so *"which exploration target should we drill?"*
was classified as a production question and answered with tonnage figures.

Three changes fix that class of bug rather than that one instance:

1. **Phrases beat words.** "exploration target" and "drill target" are matched
   whole, before any single word is considered. Multi-word evidence is stronger
   evidence, and it is where the disambiguation actually lives.

2. **Every intent is scored; the best wins.** The old chain let declaration order
   decide, so adding a keyword to an early branch silently stole queries from a
   later one. Scoring makes ties visible instead of resolving them by accident.

3. **Ambiguous words are owned by nobody.** A token appearing in several intents'
   vocabularies contributes to none of them — it carries no signal about which
   was meant, and letting it vote just reintroduces the ordering problem.

Deterministic and offline on purpose: routing a question to the wrong evidence is
worse than declining to route it, and an LLM cannot be held to that standard.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass(frozen=True)
class IntentSpec:
    key: str
    label: str
    #: Multi-word phrases, matched first and weighted heavily.
    phrases: tuple[str, ...] = ()
    #: Single words. Any that appear under more than one intent are discarded.
    words: tuple[str, ...] = ()


INTENTS: tuple[IntentSpec, ...] = (
    IntentSpec(
        key="production_risk",
        label="Production risk",
        phrases=(
            "production forecast", "production plan", "production risk",
            "hit target", "meet target", "miss target", "production target",
            "behind plan", "below plan", "shortfall", "tonnes today",
            "output today", "how much will we produce",
        ),
        words=("produce", "production", "forecast", "tonnage", "quota", "output", "plan"),
    ),
    IntentSpec(
        key="equipment_risk",
        label="Equipment risk",
        phrases=(
            "equipment failure", "machine failure", "failure risk",
            "breakdown risk", "maintenance overdue", "fleet availability",
            "which machine", "which truck",
        ),
        words=(
            "truck", "loader", "excavator", "machine", "equipment", "fleet",
            "maintenance", "breakdown", "downtime", "servicing",
        ),
    ),
    IntentSpec(
        key="exploration_target",
        label="Exploration target",
        phrases=(
            "exploration target", "drill target", "prospectivity",
            "where should we explore", "which target", "target to drill",
            "ore body", "mineral potential",
        ),
        words=("explore", "exploration", "drill", "deposit", "geology", "geochemical", "prospect"),
    ),
    IntentSpec(
        key="material_flow",
        label="Material flow",
        phrases=(
            "material flow", "what is limiting", "limiting production",
            "where is the bottleneck", "stage utilisation", "stage utilization",
        ),
        words=("bottleneck", "flow", "crusher", "haulage", "throughput", "stockpile", "constraint"),
    ),
    IntentSpec(
        key="model_health",
        label="Model health",
        phrases=("model drift", "model accuracy", "champion model", "which model is serving"),
        words=("challenger", "champion", "drift", "auc", "roc", "calibration", "retrain"),
    ),
    IntentSpec(
        key="decision_history",
        label="Decision history",
        phrases=(
            "what happened last time", "previous decision", "past decision",
            "decision history", "did it work", "what did we do",
        ),
        words=("decision", "outcome", "precedent", "history", "approved", "rejected"),
    ),
)

#: Words claimed by more than one intent carry no signal about which was meant.
#: "target" is the motivating case: production and exploration both use it.
_AMBIGUOUS: frozenset[str] = frozenset(
    word
    for word in {w for spec in INTENTS for w in spec.words}
    if sum(1 for spec in INTENTS if word in spec.words) > 1
) | {"target", "targets", "risk", "grade", "shift", "mine", "data"}

#: A phrase is decisive; a word is a hint.
PHRASE_WEIGHT = 10.0
WORD_WEIGHT = 1.0

#: Below this the question is not confidently about anything in particular.
MIN_SCORE = 1.0


@dataclass
class Classification:
    intent: str
    label: str
    score: float
    #: What actually matched, so a wrong answer can be diagnosed.
    matched: list[str] = field(default_factory=list)
    #: Other intents that scored, for the "did you mean" case.
    runners_up: list[tuple[str, float]] = field(default_factory=list)
    ambiguous: bool = False

    def as_dict(self) -> dict:
        return {
            "intent": self.intent,
            "label": self.label,
            "score": round(self.score, 2),
            "matched": self.matched,
            "runners_up": [{"intent": k, "score": round(v, 2)} for k, v in self.runners_up],
            "ambiguous": self.ambiguous,
        }


def _words(text: str) -> set[str]:
    return set(re.findall(r"[a-z]+", text.lower()))


def classify(query: str) -> Classification:
    """Classify a question, or return `general` when nothing scores."""
    text = query.lower()
    tokens = _words(text)

    scores: dict[str, float] = {}
    matches: dict[str, list[str]] = {}

    for spec in INTENTS:
        score = 0.0
        hit: list[str] = []

        for phrase in spec.phrases:
            if phrase in text:
                score += PHRASE_WEIGHT
                hit.append(f'"{phrase}"')

        for word in spec.words:
            if word in _AMBIGUOUS:
                continue
            if word in tokens:
                score += WORD_WEIGHT
                hit.append(word)

        if score > 0:
            scores[spec.key] = score
            matches[spec.key] = hit

    if not scores:
        return Classification(intent="general", label="General", score=0.0)

    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    best_key, best_score = ranked[0]

    if best_score < MIN_SCORE:
        return Classification(
            intent="general", label="General", score=best_score,
            runners_up=[(k, v) for k, v in ranked[:3]],
        )

    spec = next(s for s in INTENTS if s.key == best_key)
    # A near-tie is reported rather than hidden: the caller can offer a choice
    # instead of answering the wrong question confidently.
    ambiguous = len(ranked) > 1 and (best_score - ranked[1][1]) < WORD_WEIGHT

    return Classification(
        intent=best_key,
        label=spec.label,
        score=best_score,
        matched=matches[best_key],
        runners_up=[(k, v) for k, v in ranked[1:4]],
        ambiguous=ambiguous,
    )


__all__ = ["Classification", "INTENTS", "IntentSpec", "classify"]
