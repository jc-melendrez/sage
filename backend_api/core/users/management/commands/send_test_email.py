from django.conf import settings
from django.core.mail import send_mail
from django.core.management.base import BaseCommand, CommandError

from users.otp import _gmail_configured, _send_via_gmail


class Command(BaseCommand):
    """
    Send a test email through the exact path the login OTP uses.

    Useful for diagnosing "no OTP arrives": a 2xx from the Gmail API means the
    message was ACCEPTED, not delivered. If this command reports success but
    nothing lands, check the Gmail account's Sent mail (and spam), and confirm
    GMAIL_SENDER_EMAIL matches the account that granted the refresh token.
    """

    help = 'Send a test email via the configured OTP delivery path (Gmail API or SMTP).'

    def add_arguments(self, parser):
        parser.add_argument('recipient', help='Email address to send the test to')

    def handle(self, *args, **options):
        recipient = options['recipient']
        subject = 'SAGE test email'
        body = (
            'This is a SAGE delivery test.\n\n'
            'If you received it, the configured mail path works.'
        )

        if _gmail_configured():
            self.stdout.write(
                f'Delivering via Gmail API to {recipient} '
                f'(sender={settings.GMAIL_SENDER_EMAIL})...'
            )
            try:
                _send_via_gmail(subject, body, [recipient])
            except Exception as exc:
                raise CommandError(f'Gmail API send failed: {exc}')
        else:
            self.stdout.write(
                f'Delivering via SMTP to {recipient} '
                f'(from={settings.DEFAULT_FROM_EMAIL})...'
            )
            sent = send_mail(
                subject, body, settings.DEFAULT_FROM_EMAIL, [recipient],
                fail_silently=False,
            )
            if not sent:
                raise CommandError('SMTP backend reported 0 messages sent.')

        self.stdout.write(self.style.SUCCESS(
            f'Provider accepted the message for {recipient}. Check the inbox '
            '(and spam); if it never arrives, check the Gmail account for a '
            'bounce or a rejected refresh token.'
        ))
