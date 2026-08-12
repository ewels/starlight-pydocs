"""Pydantic models, documented through the `griffe_pydantic` extension."""

from pydantic import BaseModel, Field, field_validator


class User(BaseModel):
    """Someone who can own a report."""

    name: str = Field(description="Display name of the user.")
    email: str = Field(description="Contact address, lowercased on validation.")
    reports: int = Field(default=0, ge=0, description="How many reports the user owns.")

    @field_validator("email")
    @classmethod
    def _lowercase(cls, value: str) -> str:
        """Normalise the address before it is stored."""
        return value.lower()
