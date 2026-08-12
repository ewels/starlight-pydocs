"""Backwards compatible aliases, without an `__all__`.

The public surface of this module is inferred: `legacy_name` and `LEGACY_LIMIT`
are public, `_shim` is private, and `Report` is an import (so it is only shown
when imported members are not filtered out).
"""

from .report import Report

LEGACY_LIMIT = 100
"""Largest report size the old API accepted."""


def legacy_name(report: Report) -> str:
    """Return the name the old API would have used.

    Args:
        report: Report to name.

    Returns:
        The legacy name.
    """
    return _shim(report.name)


def _shim(name: str) -> str:
    """Old naming rule. Private."""
    return name.replace(" ", "_").lower()
