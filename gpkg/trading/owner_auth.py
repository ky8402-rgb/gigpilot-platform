"""Canonical owner authentication."""
from gpkg.api.auth import extract_token, get_owner_auth, require_owner, verify_totp, generate_totp

# Re-export shim: `verify_totp`/`generate_totp` are carried so callers can reach them through this
# module. They are deliberately unused here.
__all__ = ["extract_token", "get_owner_auth", "require_owner", "verify_totp", "generate_totp",
           "ownerAuth", "isOwner", "requireOwnerAuth"]
ownerAuth=get_owner_auth()
def isOwner(request): return ownerAuth.verify(extract_token(request) or '')
requireOwnerAuth=require_owner
