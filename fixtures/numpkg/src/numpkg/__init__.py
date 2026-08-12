"""Small package with numpy-style docstrings.

Exists so the parser tests cover the numpy section syntax (underlined section
titles, `name : type` parameter lines).
"""

__all__ = ["Grid", "resample"]


class Grid:
    """A rectangular grid of samples.

    Parameters
    ----------
    width : int
        Number of columns.
    height : int
        Number of rows.

    Attributes
    ----------
    width : int
        Number of columns.
    height : int
        Number of rows.
    """

    def __init__(self, width: int, height: int) -> None:
        self.width = width
        self.height = height

    def area(self) -> int:
        """Compute the number of cells.

        Returns
        -------
        int
            Width multiplied by height.
        """
        return self.width * self.height


def resample(grid: Grid, factor: float = 2.0) -> Grid:
    """Scale a grid by a factor.

    Parameters
    ----------
    grid : Grid
        The grid to scale.
    factor : float, optional
        Multiplier applied to both dimensions, by default 2.0.

    Returns
    -------
    Grid
        A new, scaled grid.

    Raises
    ------
    ValueError
        If `factor` is not positive.

    Examples
    --------
    >>> resample(Grid(2, 3), 2.0).area()
    24
    """
    if factor <= 0:
        raise ValueError("factor must be positive")
    return Grid(int(grid.width * factor), int(grid.height * factor))
