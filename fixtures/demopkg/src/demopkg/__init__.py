"""Demo package used by the starlight-pydocs test suite.

`demopkg` exists to exercise every feature of the documentation renderer:
google-style docstring sections, inheritance, overloads, positional-only and
keyword-only parameters, re-exports through `__all__`, pydantic models,
deprecations and private members that must stay hidden.

The public surface is declared explicitly in `__all__`, so anything not listed
there is invisible to the default member filter.

Examples:
    Build a report and write it to disk:

    >>> from demopkg import Report
    >>> report = Report("weekly")
    >>> report.generate("summary", title="Weekly")
    PosixPath('weekly.txt')
"""

DEFAULT_TIMEOUT: float = 30.0
"""Seconds to wait for report generation before giving up.

Used as the default for [`Report.generate`][demopkg.report.Report.generate].
"""

from .report import Report, generate_report  # noqa: E402

__all__ = ["Report", "generate_report", "DEFAULT_TIMEOUT", "models", "utils"]
