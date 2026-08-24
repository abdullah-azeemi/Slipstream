"""
    Clerk Session Token Verification

Verifies RS256 signatures against Clerk's published JWKS. Only the
agent blueprint calls this today; other routes stay public until they
learn about users.
"""

from __future__ import annotations
from functools import lru_cache
import jwt
from backend.config import settings


class ClerkAuthError(Exception):
    """It is raised when a bearer token is absent"""


@lru_cache(maxsize=1)
def _jwks_client() -> jwt.PyJWKClient:
    """Build one JWKS client per process; PyJWT caches the keys internally"""
    if not settings.clerk_issuer:
        raise ClerkAuthError("Clerk issuer is not configured")
    url = f"{settings.clerk_issuer.rstrip('/')}/.well-known/jwks.json"
    return jwt.PyJWKClient(url, cache_keys=True)


def verify_session_token(token: str) -> str:
    """Return the clerk_user_id ('sub') for a valid session token."""
    try:
        signing_key = _jwks_client().get_signing_key_from_jwt(token)
    except jwt.PyJWKClientError as exc:
        raise ClerkAuthError(f"cannot resolve signing key: {exc}") from exc
    try:
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=settings.clerk_issuer.rstrip("/"),
            options={"verify_aud": False},
        )
    except jwt.InvalidTokenError as exc:
        raise ClerkAuthError(f"invalid token: {exc}") from exc
    sub = payload.get("sub")
    if not sub:
        raise ClerkAuthError("token has no 'sub' claim")
    return str(sub)
