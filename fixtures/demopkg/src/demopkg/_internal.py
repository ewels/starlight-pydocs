"""Private module. Filtered out of the navigation by default."""

SECRET = "not documented"
"""A constant nobody should see in the rendered docs."""


def internal_only(value: str) -> str:
    """Do something nobody needs to read about.

    Args:
        value: Anything at all.

    Returns:
        The value, unchanged.
    """
    return value
