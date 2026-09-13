"""app/api/core/routing/explain.py — why this route was recommended.

The breakdown is derived from the same weighted terms the search minimised, so
the explanation and the decision cannot disagree. A factor's contribution is

    contribution_i = weight_i * mean_factor_i_along_route

and its share is that value over the sum across factors. This is exact rather
than attributed after the fact: these are literally the terms that were summed
to rank the routes.

Comparison prose is assembled from computed deltas — no sentence states a number
that was not measured.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .astar import RouteResult
from .config import CostWeights, risk_band
from .cost import FACTOR_LABELS, FACTORS, CostSurface


@dataclass
class FactorContribution:
    factor: str
    label: str
    #: Mean factor value along the route, 0..1.
    intensity: float
    #: Points of the 0..100 risk score attributable to this factor.
    points: float
    #: Share of total risk, 0..100.
    share_pct: float

    def as_dict(self) -> dict[str, Any]:
        return {
            "factor": self.factor,
            "label": self.label,
            "intensity": round(self.intensity, 4),
            "points": round(self.points, 2),
            "share_pct": round(self.share_pct, 1),
        }


def risk_breakdown(route: RouteResult, weights: CostWeights) -> list[FactorContribution]:
    """Decompose a route's risk score into its factors, largest first."""
    w = weights.risk_weights
    raw = {f: w[f] * route.factor_means[f] for f in FACTORS}
    total = sum(raw.values())

    # The score is normalised against the maximum the weighting can produce;
    # points must use the same denominator or they will not sum to the score.
    denom = max(1e-9, weights.max_risk_weight_sum)

    contributions = [
        FactorContribution(
            factor=f,
            label=FACTOR_LABELS[f],
            intensity=route.factor_means[f],
            points=100.0 * raw[f] / denom,
            share_pct=(100.0 * raw[f] / total) if total > 1e-9 else 0.0,
        )
        for f in FACTORS
    ]
    contributions.sort(key=lambda c: c.points, reverse=True)
    return contributions


def _pct_change(new: float, old: float) -> float | None:
    if abs(old) < 1e-9:
        return None
    return (new - old) / old * 100.0


def compare_routes(
    chosen: RouteResult,
    baseline: RouteResult,
    weights: CostWeights,
) -> dict[str, Any]:
    """Quantify how the chosen route differs from a baseline."""
    dist = _pct_change(chosen.distance_km, baseline.distance_km)
    risk = _pct_change(chosen.risk_score, baseline.risk_score)
    time = _pct_change(chosen.travel_time_min, baseline.travel_time_min)

    chosen_bd = {c.factor: c for c in risk_breakdown(chosen, weights)}
    base_bd = {c.factor: c for c in risk_breakdown(baseline, weights)}

    # Where the risk difference actually comes from, factor by factor.
    deltas = sorted(
        (
            {
                "factor": f,
                "label": FACTOR_LABELS[f],
                "delta_points": round(chosen_bd[f].points - base_bd[f].points, 2),
            }
            for f in FACTORS
        ),
        key=lambda d: d["delta_points"],
    )

    return {
        "distance_delta_pct": round(dist, 1) if dist is not None else None,
        "risk_delta_pct": round(risk, 1) if risk is not None else None,
        "time_delta_pct": round(time, 1) if time is not None else None,
        "distance_delta_km": round(chosen.distance_km - baseline.distance_km, 3),
        "risk_delta_points": round(chosen.risk_score - baseline.risk_score, 1),
        "time_delta_min": round(chosen.travel_time_min - baseline.travel_time_min, 1),
        "factor_deltas": deltas,
    }


def explain_recommendation(
    chosen: RouteResult,
    alternatives: list[RouteResult],
    weights: CostWeights,
    *,
    shortest: RouteResult | None = None,
) -> dict[str, Any]:
    """Build the recommendation narrative from measured values only."""
    breakdown = risk_breakdown(chosen, weights)
    band, tone = risk_band(chosen.risk_score)

    top = breakdown[0] if breakdown else None
    sentences: list[str] = []

    # 1. What was chosen and how risky it is.
    sentences.append(
        f"The recommended route covers {chosen.distance_km:.1f} km in about "
        f"{chosen.travel_time_min:.0f} minutes, with an overall risk of "
        f"{chosen.risk_score:.0f}/100 ({band.lower()})."
    )

    # 2. Why it is risky at all — the dominant factor, with its real share.
    if top and top.share_pct >= 1.0:
        sentences.append(
            f"{top.label.lower().capitalize()} is the largest single contributor at "
            f"{top.share_pct:.0f}% of the route's risk."
        )

    # 3. The trade-off against the shortest option, if they differ.
    comparison: dict[str, Any] | None = None
    if shortest is not None and shortest.cells != chosen.cells:
        comparison = compare_routes(chosen, shortest, weights)
        dist_pct = comparison["distance_delta_pct"]
        risk_pct = comparison["risk_delta_pct"]

        # "the same length" needs "as", "8% longer" needs "than" — building one
        # phrase for both produces "the same length than the shortest path".
        if dist_pct is None or abs(dist_pct) < 1.0:
            length_clause = "It is the same length as the shortest path"
        else:
            length_clause = (
                f"It is {abs(dist_pct):.0f}% "
                f"{'longer' if dist_pct > 0 else 'shorter'} than the shortest path"
            )

        if risk_pct is not None and risk_pct < -1.0:
            # Only call it the deciding factor when the margin is worth acting on.
            tail = (
                ", which is why it is preferred."
                if abs(risk_pct) >= 5.0
                else ", a slim margin but the better of the two."
            )
            sentences.append(
                f"{length_clause} but carries {abs(risk_pct):.0f}% lower estimated "
                f"operational risk{tail}"
            )
        elif risk_pct is not None and risk_pct > 1.0:
            sentences.append(
                f"{length_clause} and carries {risk_pct:.0f}% higher risk."
            )
        else:
            sentences.append(f"{length_clause}, with comparable risk.")

    # 4. Why the alternatives lost.
    if alternatives:
        best_alt = min(alternatives, key=lambda r: r.risk_score)
        alt_cmp = compare_routes(chosen, best_alt, weights)
        risk_pct = alt_cmp["risk_delta_pct"]
        if risk_pct is not None and risk_pct < -1.0:
            sentences.append(
                f"The closest alternative is {abs(risk_pct):.0f}% riskier over "
                f"{best_alt.distance_km:.1f} km."
            )
        elif risk_pct is not None and abs(risk_pct) <= 1.0:
            sentences.append(
                f"The closest alternative is comparable on risk "
                f"({best_alt.risk_score:.0f}/100) over {best_alt.distance_km:.1f} km, "
                "so either is defensible."
            )

    # 5. What would actually help.
    advisories = _advisories(chosen, breakdown)

    return {
        "summary": " ".join(sentences),
        "risk_band": band,
        "risk_tone": tone,
        "dominant_factor": top.factor if top else None,
        "breakdown": [c.as_dict() for c in breakdown],
        "comparison_to_shortest": comparison,
        "advisories": advisories,
    }


#: Thresholds are on mean intensity along the route (0..1). Below these a factor
#: is present but not worth an operator changing anything over.
_ADVISORY_RULES: list[tuple[str, float, str]] = [
    ("flood", 0.35, "Standing water is significant on this route. Delay non-urgent haulage until levels drop, or switch to the drier alternative."),
    ("slope", 0.45, "Sustained grades on this route will slow loaded trucks and raise brake wear. Consider a lighter payload or the flatter alternative."),
    ("road", 0.45, "Road surface is a major contributor. Grading this corridor would cut route risk more than any dispatch change."),
    ("mining", 0.40, "The route passes close to active mining. Confirm the blast schedule before dispatch."),
    ("traffic", 0.45, "Congestion is material on this route. Staggering departures will reduce both risk and cycle time."),
    ("weather", 0.40, "Weather is degrading conditions across the site. Reassess once it clears."),
]


def _advisories(route: RouteResult, breakdown: list[FactorContribution]) -> list[dict[str, Any]]:
    """Operational advice, emitted only where the underlying factor warrants it."""
    by_factor = {c.factor: c for c in breakdown}
    out: list[dict[str, Any]] = []

    for factor, threshold, text in _ADVISORY_RULES:
        c = by_factor.get(factor)
        if c and c.intensity >= threshold:
            out.append(
                {
                    "factor": factor,
                    "label": FACTOR_LABELS[factor],
                    "severity": "high" if c.intensity >= threshold + 0.2 else "medium",
                    "message": text,
                    "intensity": round(c.intensity, 3),
                }
            )

    if not out:
        out.append(
            {
                "factor": None,
                "label": "Clear",
                "severity": "low",
                "message": "No single risk factor is severe enough on this route to warrant a change to normal haulage.",
                "intensity": 0.0,
            }
        )
    return out


def route_payload(
    route: RouteResult,
    surface: CostSurface,
    weights: CostWeights,
) -> dict[str, Any]:
    """Serialise a route with its risk decomposition."""
    band, tone = risk_band(route.risk_score)
    breakdown = risk_breakdown(route, weights)

    return {
        "label": route.label,
        "distance_km": round(route.distance_km, 3),
        "estimated_time_min": round(route.travel_time_min, 1),
        "risk_score": round(route.risk_score, 1),
        "safety_score": route.safety_score,
        "risk_band": band,
        "risk_tone": tone,
        "dominant_factor": breakdown[0].factor if breakdown else None,
        "risk_breakdown": {c.factor: c.as_dict() for c in breakdown},
        "path": [{"lat": round(lat, 6), "lon": round(lon, 6)} for lat, lon in route.coordinates],
        "geojson": route.geojson(),
        "diagnostics": {
            "nodes_expanded": route.nodes_expanded,
            "total_cost": round(route.total_cost, 3),
            "cells": len(route.cells),
        },
    }
