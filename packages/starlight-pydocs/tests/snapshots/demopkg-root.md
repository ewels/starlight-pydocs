# demopkg

*module*

Demo package used by the starlight-pydocs test suite.

`demopkg` exists to exercise every feature of the documentation renderer:
google-style docstring sections, inheritance, overloads, positional-only and
keyword-only parameters, re-exports through `__all__`, pydantic models,
deprecations and private members that must stay hidden.

The public surface is declared explicitly in `__all__`, so anything not listed
there is invisible to the default member filter.

**Examples**

Build a report and write it to disk:

```pycon
>>> from demopkg import Report
>>> report = Report("weekly")
>>> report.generate("summary", title="Weekly")
PosixPath('weekly.txt')
```

## demopkg.DEFAULT_TIMEOUT

*attribute* · *module attribute*

```python
DEFAULT_TIMEOUT: float = 30.0
```

Seconds to wait for report generation before giving up.

Used as the default for [`Report.generate`][demopkg.report.Report.generate].

## demopkg.Report

*class*

```python
class Report(BaseReport)
```

Bases: `demopkg.report.BaseReport`

Re-exported from: `demopkg.report`

A named collection of scored sections.

**Parameters**

- `name` (`str`) — Human readable report name, also used as the file stem.
- `scores` (`dict[str, float] | None`) (default: `None`) — Mapping of metric name to score. Defaults to an empty mapping.

**Attributes**

- `name` — The report name.
- `scores` (`dict[str, float]`) — The scores passed to the constructor.

### demopkg.Report.name

*attribute* · *instance attribute*

```python
name = name
```

The report name.

### demopkg.Report.scores

*attribute* · *instance attribute*

```python
scores: dict[str, float] = scores or {}
```

Mapping of metric name to score.

### demopkg.Report.format

*attribute* · *class attribute* · *instance attribute*

```python
format: str = 'txt'
```

Inherited from: `demopkg.report.BaseReport`

Default output format, as a bare file extension.

### demopkg.Report.title

*property* · *writable*

```python
title: str
```

Title used in the rendered output.

### demopkg.Report.is_valid

*property*

```python
is_valid: bool
```

Inherited from: `demopkg.report.BaseReport`

Whether [`validate`][demopkg.report.BaseReport.validate] passes.

### demopkg.Report.from_mapping

*method* · *classmethod*

```python
def from_mapping(data: Mapping[str, float], *, name: str = 'report') -> Report
```

Build a report from an existing mapping of scores.

**Parameters**

- `data` (`Mapping[str, float]`) — Metric name to score.
- `name` (`str`) (default: `'report'`) — Name for the new report.

**Returns**

- (`Report`) — A new report holding a copy of `data`.

### demopkg.Report.generate

*method*

```python
def generate(*sections: str, title: str | None = None, timeout: float = DEFAULT_TIMEOUT, **options: Any) -> pathlib.Path
```

Render the report and return the path it was written to.

**Parameters**

- `*sections` (`str`) (default: `()`) — Section names to include, in order. When empty every known section is rendered.
- `title` (`str | None`) (default: `None`) — Overrides the report title. Defaults to the report name.
- `timeout` (`float`) (default: `DEFAULT_TIMEOUT`) — Seconds to wait before giving up.
- `**options` (`Any`) (default: `{}`) — Extra renderer options, passed through untouched.

**Returns**

- (`pathlib.Path`) — The path of the file that was written.

**Raises**

- `ReportError` — If a requested section does not exist.
- `TimeoutError` — If rendering takes longer than `timeout`.

> **Note**
>
> Generation is deliberately synchronous; run it in a thread if you
> need to keep an event loop responsive.

**Examples**

```pycon
>>> Report("weekly").generate("summary", title="Weekly")
PosixPath('weekly.txt')
```

### demopkg.Report.render

*method*

```python
def render(value: str | list[str]) -> str | list[str]
```

Render one section or a list of sections.

**Parameters**

- `value` (`str | list[str]`) — A single section name or a list of them.

**Returns**

- (`str | list[str]`) — Rendered output matching the shape of `value`.

### demopkg.Report.supported_formats

*method* · *staticmethod*

```python
def supported_formats() -> tuple[str, ...]
```

List the formats a report can be saved as.

**Returns**

- (`tuple[str, ...]`) — Format extensions, without leading dots.

### demopkg.Report.save

*method*

```python
def save(path: pathlib.Path) -> None
```

Inherited from: `demopkg.report.BaseReport`

Write the rendered report to `path`.

**Parameters**

- `path` (`pathlib.Path`) — Destination file. Parent directories must exist.

**Raises**

- `OSError` — If the file cannot be written.

### demopkg.Report.validate

*method*

```python
def validate() -> bool
```

Inherited from: `demopkg.report.BaseReport`

Check the report for structural problems.

**Returns**

- (`bool`) — True when the report is well formed.

## demopkg.generate_report

*function*

```python
def generate_report(source, /, name: str, *, fmt: str = 'md') -> Report
```

Re-exported from: `demopkg.report`

Build a report from a source object.

Exercises a positional-only parameter (`source`, before the `/`) and a
keyword-only one (`fmt`, after the `*`).

**Parameters**

- `source` — Anything with a `read()` method; deliberately unannotated.
- `name` (`str`) — Name for the resulting report.
- `fmt` (`str`) (default: `'md'`) — Output format for the report.

**Returns**

- (`Report`) — A populated report.

**Raises**

- `ReportError` — If `source` cannot be read.

**Modules**

- `demopkg.compat`
- `demopkg.models`
- `demopkg.report`
- `demopkg.utils`
