"""Canonical Bybit error definitions."""
from gpkg.core.errors import BybitError,DUPLICATE_ORDER_LINK_CODE

# Re-export shim: these names are imported to BE this module's public surface, not to be used
# here. Declaring them makes the intent explicit and machine-checkable instead of looking like a
# leftover import; removing one would break `from gpkg.trading.bybit_errors import BybitError`.
__all__ = ["BybitError", "DUPLICATE_ORDER_LINK_CODE", "BYBIT_ERROR_MAP", "formatBybitError"]
BYBIT_ERROR_MAP={}
def formatBybitError(error): return str(error)
