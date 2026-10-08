"""IPv4-pinned SMTP email backend.

On Render, smtp.gmail.com sometimes resolves to an IPv6 address the host has
no route for; `socket.connect()` then dies with `OSError: [Errno 101] Network
is unreachable` and the OTP email never goes out (login 503s). This backend
resolves the host over IPv4 only and tries every returned address, so the
message leaves over the (working) v4 route.

The SMTP session is otherwise unchanged: same host/port/TLS/auth settings.
"""

import smtplib
import socket

from django.core.mail.backends.smtp import EmailBackend


def _ipv4_addresses(host: str, port: int):
    """Resolve `host` to IPv4 (AF_INET) sockaddr candidates."""
    try:
        infos = socket.getaddrinfo(host, port, socket.AF_INET, socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise OSError(f'cannot resolve {host}:{port} ({exc})') from exc
    return [info[4] for info in infos]


class Ipv4SMTP(smtplib.SMTP):
    """smtplib.SMTP that connects using IPv4 addresses only."""

    def _get_socket(self, host, port, timeout):
        last_error = None
        for sockaddr in _ipv4_addresses(host, port):
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            try:
                sock.connect(sockaddr)
                return sock
            except OSError as exc:
                last_error = exc
                sock.close()
        if last_error is not None:
            raise last_error
        raise OSError(f'no IPv4 addresses resolved for {host}:{port}')


class Ipv4EmailBackend(EmailBackend):
    """Django SMTP backend pinned to IPv4 so Gmail egress works on Render."""

    @property
    def connection_class(self):
        return Ipv4SMTP if not self.use_ssl else smtplib.SMTP_SSL