"""Post short notices to the team's Slack channel through an incoming webhook."""

import json
import urllib.request

import structlog

from backend.config import settings
from backend.net import safe_urlopen

log = structlog.get_logger()


def notify_slack(text: str) -> bool:
    """Send one message. Never raises: a Slack outage must not break the caller."""
    if not settings.slack_webhook_url:
        return False
    request = urllib.request.Request(
        settings.slack_webhook_url,
        data=json.dumps({"text": text}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with safe_urlopen(request, timeout=5):
            return True
    except Exception as exc:  # noqa: BLE001
        log.warning("slack.notify_failed", error=str(exc))
        return False
