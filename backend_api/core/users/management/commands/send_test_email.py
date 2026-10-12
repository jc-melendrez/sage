from django.conf import settings
from django.core.mail import send_mail
from django.core.management.base import BaseCommand, CommandError

from users.otp import _send_via_brevo


class Command(BaseCommand):
    """
    Send a test email through the exact path the login OTP uses.

    Useful for diagnosing "no OTP arrives": a 2xx from Brevo means the message
    was ACCEPTED, not delivered. If this command reports success but nothing
    lands, check the Brevo dashboard (Transactional -> Logs) for a blocked,
    bounced or spam event, and confirm BREVO_SENDER_EMAIL is a verified sender.
    """

    help = 'Send a test email via the configured OTP delivery path (Brevo or SMTP).'

    def add_arguments(self, parser):
        parser.add_argument('recipient', help='Email address to send the test to')

    def handle(self, *args, **options):
        recipient = options['recipient']
        subject = 'SAGE test email'
        body = (
            'This is a SAGE delivery test.\n\n'
            'If you received it, the configured mail path works.'
        )

        if getattr(settings, 'BREVO_API_KEY', None):
            self.stdout.write(
                f'Delivering via Brevo API to {recipient} '
                f'(sender={settings.BREVO_SENDER_EMAIL})...'
            )
            try:
                _send_via_brevo(subject, body, [recipient])
            except Exception as exc:
                raise CommandError(f'Brevo send failed: {exc}')
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
            '(and spam); if it never arrives, inspect the Brevo dashboard '
            'Transactional -> Logs.'
        ))
