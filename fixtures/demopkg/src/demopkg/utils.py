"""Helpers that operate on reports.

Everything here is a plain function; the module has no `__all__`, so the public
surface comes from the `is_public` heuristics (no leading underscore, not
imported).
"""

from collections.abc import Iterator
from typing import Any

from .report import Report, ReportError

SECTION_STYLES: dict[str, dict[str, str]] = {
    "summary": {"colour": "#1b1f2a", "marker": "*", "caption": "Summary, at a glance"},
    "detail": {"colour": "#2a334e", "marker": "-", "caption": "Detail (one row per metric)"},
    "appendix": {"colour": "#f2c641", "marker": "+", "caption": "Appendix [optional, omitted by default]"},
    "footer": {"colour": "#aab2c4", "marker": ".", "caption": "Footer, with the generated-at stamp"},
}
"""How each section of a rendered report is presented.

Deliberately long: it is the fixture for a signature whose value is broken
across lines at its brackets and then folded behind a toggle. The captions hold
brackets, commas and quotes so the line-breaker has string literals to step
over.
"""


def iter_sections(report: Report) -> Iterator[str]:
    """Walk the sections of a report in render order.

    Args:
        report: The report to walk.

    Yields:
        Section names, uppercased.

    Examples:
        >>> list(iter_sections(Report("weekly")))
        []
    """
    for name in sorted(report.scores):
        yield name.upper()


def merge_scores(left: Report, right: Report) -> dict[str, float]:
    """Combine the scores of two reports.

    Args:
        left: Report whose scores take precedence.
        right: Report contributing the remaining scores.

    Returns:
        A new mapping holding both sets of scores.

    Raises:
        ReportError: If the two reports disagree on a metric.
        TypeError: If either argument is not a report.
        ValueError: If either report has no scores.
    """
    if not isinstance(left, Report) or not isinstance(right, Report):
        raise TypeError("expected reports")
    if not left.scores or not right.scores:
        raise ValueError("reports have no scores")
    if set(left.scores) & set(right.scores):
        raise ReportError("conflicting metrics")
    return {**right.scores, **left.scores}


def describe(report: Report, **extra: Any) -> str:
    """Summarise a report in one line.

    Args:
        report: The report to describe.
        **extra: Extra key/value pairs appended to the summary.

    Returns:
        A single line of plain text.
    """
    return _private_helper(report.name, extra)


def _private_helper(name: str, extra: dict[str, Any]) -> str:
    """Format a summary line. Private, so it must never be documented."""
    return f"{name} {sorted(extra)}"
