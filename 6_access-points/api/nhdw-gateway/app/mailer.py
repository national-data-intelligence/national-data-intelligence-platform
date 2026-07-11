"""Centralised app SMTP mailer → external Google SMTP relay.

Every app-generated email flows through here: disease-surveillance alert
notifications, access-grant / password-reset links, submission-decision mails.
Sending is BEST-EFFORT: a mail failure never blocks the in-app notification (the
topbar bell / "My alerts" panel is the source of truth). `smtplib` is stdlib;
the blocking send runs in a thread executor so the async evaluator never stalls
the event loop.

SMTP_* default to Gmail (settings.py: smtp.gmail.com:587 STARTTLS); USER/PASS are
the app-password from the gitignored smtp-secrets Secret. With them absent a send
fails LOUDLY rather than silently sinking to a fake inbox — email is a real,
tested feature now (the in-cluster Mailpit sink was retired 2026-07-06).
"""
from __future__ import annotations

import asyncio
import logging
import smtplib
from email.message import EmailMessage

from .settings import settings

log = logging.getLogger("gateway.mailer")


def _send_blocking(to_addr: str, subject: str, body: str) -> None:
    msg = EmailMessage()
    msg["From"] = settings.SMTP_FROM
    msg["To"] = to_addr
    msg["Subject"] = subject
    msg.set_content(body)
    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as s:
        # Authenticated relay: Gmail = STARTTLS on 587 + app-password login.
        if settings.SMTP_TLS:
            s.starttls()
        if settings.SMTP_USER:
            s.login(settings.SMTP_USER, settings.SMTP_PASS)
        s.send_message(msg)


async def send(to_addr: str, subject: str, body: str) -> bool:
    """Send one text email. Returns True on success, False on any failure
    (logged, never raised) or when SMTP/recipient is unconfigured."""
    if not settings.SMTP_HOST or not to_addr:
        return False
    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(None, _send_blocking, to_addr, subject, body)
        return True
    except Exception as e:  # noqa: BLE001 — best-effort; never block the alert
        log.warning("alert email to %s failed: %s", to_addr, e)
        return False
