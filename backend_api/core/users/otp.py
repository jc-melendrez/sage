"""
Email-OTP helpers for the email/password login flow.

Security notes:
- Codes are 6 digits generated with `secrets` (CSPRNG).
- Codes are stored HMAC-SHA256 hashed (keyed with SECRET_KEY), never plaintext.
- Verification uses `secrets.compare_digest` to avoid timing attacks.
"""
import hashlib
import hmac
import logging
import secrets

import requests
from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone

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
    if getattr(settings, 'BREVO_API_KEY', None):
        # Render free drops outbound SMTP entirely, so prod OTP mail goes over
        # HTTPS to Brevo's API. The sender must be verified as a Sender in the
        # Brevo dashboard; errors raise so the login view can answer a clean 503.
        _send_via_brevo(subject, body, [user.email])
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


def _send_via_brevo(subject: str, text: str, recipients) -> None:
    """Deliver a plain-text email through Brevo's HTTPS API."""
    response = requests.post(
        'https://api.brevo.com/v3/smtp/email',
        headers={'api-key': settings.BREVO_API_KEY},
        json={
            'sender': {
                'email': settings.BREVO_SENDER_EMAIL,
                'name': settings.BREVO_SENDER_NAME,
            },
            'to': [{'email': email} for email in recipients],
            'subject': subject,
            'textContent': text,
        },
        timeout=settings.EMAIL_TIMEOUT,
    )
    if response.status_code >= 400:
        logger.error(
            'Brevo send failed (%s): %s', response.status_code, response.text,
        )
        raise RuntimeError(f'Brevo send failed ({response.status_code})')
