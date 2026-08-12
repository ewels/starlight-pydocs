"""Report classes and the functions that build them.

This module holds the bulk of the fixture surface: a base class, a subclass
that inherits and overrides members, overloaded methods, a static method, a
class method, a property with a setter, and the package's exception types.
"""

from __future__ import annotations

import pathlib
import typing
from typing import Any

from typing_extensions import deprecated

from . import DEFAULT_TIMEOUT

if typing.TYPE_CHECKING:
    from collections.abc import Mapping


class BaseReport:
    """Common behaviour shared by every report.

    Attributes:
        format: File extension used when a report is saved without one.
    """

    format: str = "txt"
    """Default output format, as a bare file extension."""

    def save(self, path: pathlib.Path) -> None:
        """Write the rendered report to `path`.

        Args:
            path: Destination file. Parent directories must exist.

        Raises:
            OSError: If the file cannot be written.
        """
        path.write_text("")

    def validate(self) -> bool:
        """Check the report for structural problems.

        Returns:
            True when the report is well formed.
        """
        return True

    @property
    def is_valid(self) -> bool:
        """Whether [`validate`][demopkg.report.BaseReport.validate] passes."""
        return self.validate()


class Report(BaseReport):
    """A named collection of scored sections.

    Args:
        name: Human readable report name, also used as the file stem.
        scores: Mapping of metric name to score. Defaults to an empty mapping.

    Attributes:
        name: The report name.
        scores: The scores passed to the constructor.
    """

    def __init__(self, name: str, scores: dict[str, float] | None = None) -> None:
        self.name = name
        """The report name."""
        self.scores: dict[str, float] = scores or {}
        """Mapping of metric name to score."""
        self._title = name

    def generate(
        self,
        *sections: str,
        title: str | None = None,
        timeout: float = DEFAULT_TIMEOUT,
        **options: Any,
    ) -> pathlib.Path:
        """Render the report and return the path it was written to.

        Args:
            *sections: Section names to include, in order. When empty every
                known section is rendered.
            title: Overrides the report title. Defaults to the report name.
            timeout: Seconds to wait before giving up.
            **options: Extra renderer options, passed through untouched.

        Returns:
            The path of the file that was written.

        Raises:
            ReportError: If a requested section does not exist.
            TimeoutError: If rendering takes longer than `timeout`.

        Note:
            Generation is deliberately synchronous; run it in a thread if you
            need to keep an event loop responsive.

        Examples:
            >>> Report("weekly").generate("summary", title="Weekly")
            PosixPath('weekly.txt')
        """
        if not sections:
            sections = ("summary",)
        del title, timeout, options
        return pathlib.Path(f"{self.name}.{self.format}")

    @typing.overload
    def render(self, value: str) -> str: ...

    @typing.overload
    def render(self, value: list[str]) -> list[str]: ...

    def render(self, value: str | list[str]) -> str | list[str]:
        """Render one section or a list of sections.

        Args:
            value: A single section name or a list of them.

        Returns:
            Rendered output matching the shape of `value`.
        """
        if isinstance(value, str):
            return value.upper()
        return [item.upper() for item in value]

    @staticmethod
    def supported_formats() -> tuple[str, ...]:
        """List the formats a report can be saved as.

        Returns:
            Format extensions, without leading dots.
        """
        return ("txt", "md", "html")

    @classmethod
    def from_mapping(cls, data: Mapping[str, float], *, name: str = "report") -> Report:
        """Build a report from an existing mapping of scores.

        Args:
            data: Metric name to score.
            name: Name for the new report.

        Returns:
            A new report holding a copy of `data`.
        """
        return cls(name, dict(data))

    @property
    def title(self) -> str:
        """Title used in the rendered output."""
        return self._title

    @title.setter
    def title(self, value: str) -> None:
        self._title = value


def generate_report(source, /, name: str, *, fmt: str = "md") -> Report:
    """Build a report from a source object.

    Exercises a positional-only parameter (`source`, before the `/`) and a
    keyword-only one (`fmt`, after the `*`).

    Args:
        source: Anything with a `read()` method; deliberately unannotated.
        name: Name for the resulting report.
        fmt: Output format for the report.

    Returns:
        A populated report.

    Raises:
        ReportError: If `source` cannot be read.
    """
    report = Report(name)
    report.format = fmt
    return report


# `is_deprecated` on the dump is set by griffe when it recognises the
# `deprecated` decorator statically; the `Deprecated:` docstring section is the
# portable signal and is what the renderer relies on.
@deprecated("use generate_report instead")
def old_generate(name: str) -> Report:
    """Build a report the old way.

    Deprecated:
        Since 0.3. Use [`generate_report`][demopkg.report.generate_report].

    Args:
        name: Name for the resulting report.

    Returns:
        A populated report.
    """
    return Report(name)


class ReportError(Exception):
    """Raised when a report cannot be generated."""


class ReportWarning(UserWarning):
    """Warned when a report is generated with incomplete data."""
