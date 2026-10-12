"""
Email-OTP helpers for the email/password login flow.

Security notes:
- Codes are 6 digits generated with `secrets` (CSPRNG).
- Codes are stored HMAC-SHA256 hashed (keyed with SECRET_KEY), never plaintext.
- Verification uses `secrets.compare_digest` to avoid timing attacks.
"""
import base64
import hashlib
import hmac
import logging
import secrets
from email.mime.text import MIMEText

import requests
from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials

from .models import LoginOtpChallenge

logger = logging.getLogger(__name__)


def generate_otp() -> str:
    """Return a cryptographically random 6-digit code."""
    return f"{secrets.randbelow(10**6):06d}"


def hash_otp(otp: str) -> str:
    """HMAC-SHA256 the OTP with the Django SECRET_KEY."""
    return hmac.new(
        settings.SECRET_KEY.encode(), otp.encode(), hashlib.sha256
    ).hexdigest()


def otp_matches(challenge: LoginOtpChallenge, submitted_otp: str) -> bool:
    """Constant-time comparison of the submitted code against the stored hash."""
    return hmac.compare_digest(hash_otp(submitted_otp), challenge.otp_hash)


def create_otp_challenge(user) -> LoginOtpChallenge:
    """
    Create a fresh OTP challenge for a user, invalidating previous pending ones.

    Returns the challenge; the plaintext code is only known to `send_otp_email`.
    """
    # Invalidate any pending challenges for this user so only the newest works.
    LoginOtpChallenge.objects.filter(user=user, verified=False).update(verified=True)

    otp = generate_otp()
    challenge = LoginOtpChallenge.objects.create(
        user=user,
        otp_hash=hash_otp(otp),
        expires_at=timezone.now() + timezone.timedelta(
            minutes=LoginOtpChallenge.OTP_TTL_MINUTES
        ),
    )
    send_otp_email(user, otp)
    return challenge


def send_otp_email(user, otp: str) -> None:
    """Email the OTP code. Failures are logged but must not break the flow."""
    subject = "Your SAGE verification code"
    body = (
        f"Hi {user.first_name or user.username},\n\n"
        f"Your SAGE one-time verification code is: {otp}\n\n"
        f"This code expires in {LoginOtpChallenge.OTP_TTL_MINUTES} minutes.\n"
        f"If you didn't try to sign in, you can ignore this email.\n\n"
        f"— SAGE Learning"
    )
    if _gmail_configured():
        # Render's free tier drops outbound SMTP, so prod OTP mail goes over
        # HTTPS to the Gmail API, sent as the account itself so Google signs it
        # (SPF/DKIM align). Errors raise so the login view can answer a clean 503.
        _send_via_gmail(subject, body, [user.email])
        return
    try:
        send_mail(
            subject,
            body,
            settings.DEFAULT_FROM_EMAIL,
            [user.email],
            fail_silently=False,
        )
    except Exception:
        logger.exception("Failed to send OTP email to %s", user.email)
        raise


def _gmail_configured() -> bool:
    """True when every Gmail API setting needed to send is present."""
    return all(
        getattr(settings, name, None)
        for name in (
            'GMAIL_CLIENT_ID',
            'GMAIL_CLIENT_SECRET',
            'GMAIL_REFRESH_TOKEN',
            'GMAIL_SENDER_EMAIL',
        )
    )


def _gmail_access_token() -> str:
    """Exchange the stored refresh token for a short-lived access token."""
    creds = Credentials(
        token=None,
        refresh_token=settings.GMAIL_REFRESH_TOKEN,
        token_uri='https://oauth2.googleapis.com/token',
        client_id=settings.GMAIL_CLIENT_ID,
        client_secret=settings.GMAIL_CLIENT_SECRET,
        scopes=['https://www.googleapis.com/auth/gmail.send'],
    )
    creds.refresh(Request())
    return creds.token


def _send_via_gmail(subject: str, text: str, recipients) -> None:
    """Deliver an email through the Gmail API as the configured account.

    Google signs the message, so a gmail.com "From" passes SPF/DKIM and lands --
    unlike relaying that same "From" through a third-party ESP. A 2xx only means
    the message was ACCEPTED; the returned id can be traced in Gmail if needed.
    """
    message = MIMEText(text, 'plain', 'utf-8')
    message['To'] = ', '.join(recipients)
    message['From'] = settings.GMAIL_SENDER_EMAIL
    message['Subject'] = subject
    raw = base64.urlsafe_b64encode(message.as_bytes()).decode()

    try:
        access_token = _gmail_access_token()
    except Exception:
        logger.exception(
            'Gmail API token refresh failed for %s', settings.GMAIL_SENDER_EMAIL,
        )
        raise

    response = requests.post(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        headers={'Authorization': f'Bearer {access_token}'},
        json={'raw': raw},
        timeout=settings.EMAIL_TIMEOUT,
    )
    if response.status_code >= 400:
        logger.error(
            'Gmail API send failed (%s): %s', response.status_code, response.text,
        )
        raise RuntimeError(f'Gmail API send failed ({response.status_code})')
    message_id = None
    try:
        message_id = response.json().get('id')
    except Exception:
        pass
    logger.info(
        'Gmail API accepted OTP email to %s (id=%s)', recipients, message_id,
    )
