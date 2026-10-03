"""Canonical Bybit error definitions."""
from gpkg.core.errors import BybitError,DUPLICATE_ORDER_LINK_CODE
BYBIT_ERROR_MAP={}
def formatBybitError(error): return str(error)
