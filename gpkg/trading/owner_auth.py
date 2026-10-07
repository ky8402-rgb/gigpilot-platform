"""Canonical owner authentication."""
from gpkg.api.auth import (
           extract_token,
           generate_totp,
           get_owner_auth,
           require_owner,
           verify_totp,
)

# Re-export shim: `verify_totp`/`generate_totp` are carried so callers can reach them through this
# module. They are deliberately unused here.
__all__ = [
           "extract_token",
           "generate_totp",
           "get_owner_auth",
           "isOwner",
           "ownerAuth",
           "requireOwnerAuth",
           "require_owner",
           "verify_totp",
]
ownerAuth=get_owner_auth()
def isOwner(request): return ownerAuth.verify(extract_token(request) or '')
requireOwnerAuth=require_owner
