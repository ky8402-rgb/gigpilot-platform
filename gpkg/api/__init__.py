"""FastAPI control plane: owner authentication and route wiring.

Kept separate from `gpkg/web/` (static asset delivery) so that the security boundary is an importable,
testable unit rather than middleware buried in the monolith.
"""
