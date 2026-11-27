"""Clerk webhooks: tell the team's Slack channel about new sign-ups.

Clerk delivers events through Svix. A request is trusted only when its signature
matches CLERK_WEBHOOK_SECRET; without the secret the route is switched off.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import time

from flask import Blueprint, jsonify, request

from backend.config import settings
from backend.slack import notify_slack

webhooks_bp = Blueprint("webhooks", __name__)

# Svix rejects messages older than five minutes, which stops replays.
TOLERANCE_S = 300


def valid_signature(
    secret: str, msg_id: str, timestamp: str, signatures: str, body: bytes
) -> bool:
    try:
        sent_at = int(timestamp)
        key = base64.b64decode(secret.removeprefix("whsec_"))
    except (TypeError, ValueError, binascii.Error):
        return False
    if abs(time.time() - sent_at) > TOLERANCE_S:
        return False
    signed = f"{msg_id}.{timestamp}.".encode() + body
    expected = base64.b64encode(hmac.new(key, signed, hashlib.sha256).digest())
    # The header may hold several space-separated "v1,<signature>" entries.
    return any(
        hmac.compare_digest(expected, part.removeprefix("v1,").encode())
        for part in signatures.split()
        if part.startswith("v1,")
    )


def signup_text(user: dict) -> str:
    name = " ".join(filter(None, [user.get("first_name"), user.get("last_name")]))
    primary = user.get("primary_email_address_id")
    email = next(
        (
            e.get("email_address")
            for e in user.get("email_addresses") or []
            if e.get("id") == primary
        ),
        None,
    )
    who = " ".join(filter(None, [name, f"<{email}>" if email else None]))
    return f":checkered_flag: New Slipstream sign-up: {who or 'a new user'}"


@webhooks_bp.post("/webhooks/clerk")
def clerk_webhook():
    if not settings.clerk_webhook_secret:
        return jsonify({"error": "webhook not configured"}), 404
    body = request.get_data()
    if not valid_signature(
        settings.clerk_webhook_secret,
        request.headers.get("svix-id", ""),
        request.headers.get("svix-timestamp", ""),
        request.headers.get("svix-signature", ""),
        body,
    ):
        return jsonify({"error": "invalid signature"}), 401

    event = request.get_json(silent=True) or {}
    if event.get("type") == "user.created":
        notify_slack(signup_text(event.get("data") or {}))
    # Always 200 once the signature is valid, so Svix does not retry other events.
    return jsonify({"ok": True})
