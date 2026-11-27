"""Clerk sign-up webhook: signature check and the Slack notice."""

import base64
import hashlib
import hmac
import json
import time

from backend.api.v1 import webhooks
from backend.config import settings

SECRET = "whsec_" + base64.b64encode(b"test-signing-key").decode()


def _post(client, payload, secret=SECRET):
    body = json.dumps(payload).encode()
    ts = str(int(time.time()))
    key = base64.b64decode(secret.removeprefix("whsec_"))
    sig = base64.b64encode(
        hmac.new(key, f"msg_1.{ts}.".encode() + body, hashlib.sha256).digest()
    ).decode()
    return client.post(
        "/api/v1/webhooks/clerk",
        data=body,
        content_type="application/json",
        headers={
            "svix-id": "msg_1",
            "svix-timestamp": ts,
            "svix-signature": f"v1,{sig}",
        },
    )


def test_a_signed_sign_up_is_posted_to_slack(client, monkeypatch):
    sent = []
    monkeypatch.setattr(settings, "clerk_webhook_secret", SECRET)
    monkeypatch.setattr(webhooks, "notify_slack", sent.append)
    user = {
        "first_name": "Ada",
        "primary_email_address_id": "e1",
        "email_addresses": [{"id": "e1", "email_address": "ada@example.com"}],
    }
    assert _post(client, {"type": "user.created", "data": user}).status_code == 200
    assert sent == [":checkered_flag: New Slipstream sign-up: Ada <ada@example.com>"]


def test_a_wrong_signature_is_rejected(client, monkeypatch):
    sent = []
    monkeypatch.setattr(settings, "clerk_webhook_secret", SECRET)
    monkeypatch.setattr(webhooks, "notify_slack", sent.append)
    other = "whsec_" + base64.b64encode(b"someone-else").decode()
    assert _post(client, {"type": "user.created", "data": {}}, other).status_code == 401
    assert sent == []
