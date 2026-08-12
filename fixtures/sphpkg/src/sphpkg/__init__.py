"""Small package with sphinx-style docstrings.

Exists so the parser tests cover the reStructuredText field list syntax
(`:param x:`, `:returns:`, `:raises:`).
"""

__all__ = ["Job", "submit"]


class Job:
    """A unit of queued work.

    :param label: Human readable job label.
    :param priority: Queue priority, higher runs first.
    """

    def __init__(self, label: str, priority: int = 0) -> None:
        self.label = label
        self.priority = priority

    def describe(self) -> str:
        """Summarise the job.

        :returns: A single line of plain text.
        """
        return f"{self.label} ({self.priority})"


def submit(job: Job, *, dry_run: bool = False) -> str:
    """Queue a job for execution.

    :param job: The job to queue.
    :param dry_run: When true, validate without queueing.
    :returns: The identifier assigned to the job.
    :raises ValueError: If the job has an empty label.
    """
    if not job.label:
        raise ValueError("job needs a label")
    return f"{job.label}-1" if not dry_run else "dry-run"
