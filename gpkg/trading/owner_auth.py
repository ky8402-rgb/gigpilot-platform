"""Canonical owner authentication."""
from gpkg.api.auth import extract_token, get_owner_auth, require_owner, verify_totp, generate_totp
ownerAuth=get_owner_auth()
def isOwner(request): return ownerAuth.verify(extract_token(request) or '')
requireOwnerAuth=require_owner
