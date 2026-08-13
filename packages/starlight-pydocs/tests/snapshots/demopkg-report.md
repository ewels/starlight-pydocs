# demopkg.report

*module*

Report classes and the functions that build them.

This module holds the bulk of the fixture surface: a base class, a subclass
that inherits and overrides members, overloaded methods, a static method, a
class method, a property with a setter, and the package's exception types.

[View source](https://github.com/ewels/starlight-pydocs/blob/main/fixtures/demopkg/src/demopkg/report.py#L1-L1)

## demopkg.report.BaseReport

*class*

```python
class BaseReport
```

Common behaviour shared by every report.

**Attributes**

- `format` (`str`) — File extension used when a report is saved without one.

[View source](https://github.com/ewels/starlight-pydocs/blob/main/fixtures/demopkg/src/demopkg/report.py#L22-L54)

### demopkg.report.BaseReport.format

*attribute* · *class attribute* · *instance attribute*

```python
format: str = 'txt'
```

Default output format, as a bare file extension.

[View source](https://github.com/ewels/starlight-pydocs/blob/main/fixtures/demopkg/src/demopkg/report.py#L29-L29)

### demopkg.report.BaseReport.is_valid

*property*

```python
is_valid: bool
```

Whether [`validate`][demopkg.report.BaseReport.validate] passes.

[View source](https://github.com/ewels/starlight-pydocs/blob/main/fixtures/demopkg/src/demopkg/report.py#L52-L54)

### demopkg.report.BaseReport.save

*method*

```python
def save(path: pathlib.Path) -> None
```

Write the rendered report to `path`.

**Parameters**

- `path` (`pathlib.Path`) — Destination file. Parent directories must exist.

**Raises**

- `OSError` — If the file cannot be written.

[View source](https://github.com/ewels/starlight-pydocs/blob/main/fixtures/demopkg/src/demopkg/report.py#L32-L41)

### demopkg.report.BaseReport.validate

*method*

```python
def validate() -> bool
```

Check the report for structural problems.

**Returns**

- (`bool`) — True when the report is well formed.

[View source](https://github.com/ewels/starlight-pydocs/blob/main/fixtures/demopkg/src/demopkg/report.py#L43-L49)

## demopkg.report.Report

*class*

```python
class Report(BaseReport)
```

Bases: `demopkg.report.BaseReport`

A named collection of scored sections.

**Parameters**

- `name` (`str`) — Human readable report name, also used as the file stem.
- `scores` (`dict[str, float] | None`) (default: `None`) — Mapping of metric name to score. Defaults to an empty mapping.

**Attributes**

- `name` — The report name.
- `scores` (`dict[str, float]`) — The scores passed to the constructor.

[View source](https://github.com/ewels/starlight-pydocs/blob/main/fixtures/demopkg/src/demopkg/report.py#L57-L160)

### demopkg.report.Report.name

*attribute* · *instance attribute*

```python
name = name
```

The report name.

[View source](https://github.com/ewels/starlight-pydocs/blob/main/fixtures/demopkg/src/demopkg/report.py#L70-L70)

### demopkg.report.Report.scores

*attribute* · *instance attribute*

```python
scores: dict[str, float] = scores or {}
```

Mapping of metric name to score.

[View source](https://github.com/ewels/starlight-pydocs/blob/main/fixtures/demopkg/src/demopkg/report.py#L72-L72)

### demopkg.report.Report.format

*attribute* · *class attribute* · *instance attribute*

```python
format: str = 'txt'
```

Inherited from: `demopkg.report.BaseReport`

Default output format, as a bare file extension.

[View source](https://github.com/ewels/starlight-pydocs/blob/main/fixtures/demopkg/src/demopkg/report.py#L29-L29)

### demopkg.report.Report.title

*property* · *writable*

```python
title: str
```

Title used in the rendered output.

[View source](https://github.com/ewels/starlight-pydocs/blob/main/fixtures/demopkg/src/demopkg/report.py#L154-L156)

### demopkg.report.Report.is_valid

*property*

```python
is_valid: bool
```

Inherited from: `demopkg.report.BaseReport`

Whether [`validate`][demopkg.report.BaseReport.validate] passes.

[View source](https://github.com/ewels/starlight-pydocs/blob/main/fixtures/demopkg/src/demopkg/report.py#L52-L54)

### demopkg.report.Report.from_mapping

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

[View source](https://github.com/ewels/starlight-pydocs/blob/main/fixtures/demopkg/src/demopkg/report.py#L140-L151)

### demopkg.report.Report.generate

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

[View source](https://github.com/ewels/starlight-pydocs/blob/main/fixtures/demopkg/src/demopkg/report.py#L76-L110)

### demopkg.report.Report.render

*method*

```python
def render(value: str | list[str]) -> str | list[str]
```

Render one section or a list of sections.

**Parameters**

- `value` (`str | list[str]`) — A single section name or a list of them.

**Returns**

- (`str | list[str]`) — Rendered output matching the shape of `value`.

[View source](https://github.com/ewels/starlight-pydocs/blob/main/fixtures/demopkg/src/demopkg/report.py#L118-L129)

### demopkg.report.Report.supported_formats

*method* · *staticmethod*

```python
def supported_formats() -> tuple[str, ...]
```

List the formats a report can be saved as.

**Returns**

- (`tuple[str, ...]`) — Format extensions, without leading dots.

[View source](https://github.com/ewels/starlight-pydocs/blob/main/fixtures/demopkg/src/demopkg/report.py#L131-L138)

### demopkg.report.Report.save

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

[View source](https://github.com/ewels/starlight-pydocs/blob/main/fixtures/demopkg/src/demopkg/report.py#L32-L41)

### demopkg.report.Report.validate

*method*

```python
def validate() -> bool
```

Inherited from: `demopkg.report.BaseReport`

Check the report for structural problems.

**Returns**

- (`bool`) — True when the report is well formed.

[View source](https://github.com/ewels/starlight-pydocs/blob/main/fixtures/demopkg/src/demopkg/report.py#L43-L49)

## demopkg.report.ReportError

*class*

```python
class ReportError(Exception)
```

Bases: `Exception`

Raised when a report cannot be generated.

[View source](https://github.com/ewels/starlight-pydocs/blob/main/fixtures/demopkg/src/demopkg/report.py#L209-L210)

## demopkg.report.ReportWarning

*class*

```python
class ReportWarning(UserWarning)
```

Bases: `UserWarning`

Warned when a report is generated with incomplete data.

[View source](https://github.com/ewels/starlight-pydocs/blob/main/fixtures/demopkg/src/demopkg/report.py#L213-L214)

## demopkg.report.generate_report

*function*

```python
def generate_report(source, /, name: str, *, fmt: str = 'md') -> Report
```

Build a report from a source object.

Exercises a positional-only parameter (`source`, before the `/`) and a
keyword-only one (`fmt`, after the `*`).

Returns a [Report][demopkg.report.Report] whose
[generate][demopkg.report.Report.generate] method writes a
[pathlib.Path][pathlib.Path]. A reference nothing resolves, such as
[nosuchpkg.Thing][], is left exactly as it was written.

**Parameters**

- `source` — Anything with a `read()` method; deliberately unannotated.
- `name` (`str`) — Name for the resulting report.
- `fmt` (`str`) (default: `'md'`) — Output format for the report.

**Returns**

- (`Report`) — A populated report.

**Raises**

- `ReportError` — If `source` cannot be read.

[View source](https://github.com/ewels/starlight-pydocs/blob/main/fixtures/demopkg/src/demopkg/report.py#L163-L187)

## demopkg.report.old_generate

*function*

```python
def old_generate(name: str) -> Report
```

**Deprecated**: Since 0.3. Use [`generate_report`][demopkg.report.generate_report].

Build a report the old way.

**Parameters**

- `name` (`str`) — Name for the resulting report.

**Returns**

- (`Report`) — A populated report.

[View source](https://github.com/ewels/starlight-pydocs/blob/main/fixtures/demopkg/src/demopkg/report.py#L193-L206)
