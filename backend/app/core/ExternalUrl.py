"""Validation for user supplied external links; this module never fetches URLs."""

import ipaddress
import re
from urllib.parse import urlsplit


MAX_EXTERNAL_URL_LENGTH = 2048
MAX_EXTERNAL_LINK_TITLE_LENGTH = 255
_HOST_LABEL = re.compile(r"^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$")


def validate_external_url(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("Enter a valid HTTP or HTTPS URL.")
    url = value.strip()
    if not url or len(url) > MAX_EXTERNAL_URL_LENGTH:
        raise ValueError(f"Enter a URL of at most {MAX_EXTERNAL_URL_LENGTH} characters.")
    if any(char.isspace() or ord(char) < 32 or ord(char) == 127 for char in url) or "\\" in url:
        raise ValueError("URLs cannot contain spaces, control characters, or backslashes.")
    try:
        parts = urlsplit(url)
        host = parts.hostname
        port = parts.port  # Accessing this validates the port number.
        if parts.scheme.lower() not in {"http", "https"} or not parts.netloc or not host:
            raise ValueError("Enter an absolute HTTP or HTTPS URL with a host.")
        if parts.username is not None or parts.password is not None:
            raise ValueError("URLs with embedded credentials are not allowed.")
        if port is not None and port < 1:
            raise ValueError("Enter a valid URL port.")
        try:
            ipaddress.ip_address(host)
        except ValueError:
            ascii_host = host.encode("idna").decode("ascii")
            if len(ascii_host) > 253 or not all(_HOST_LABEL.fullmatch(label) for label in ascii_host.split(".")):
                raise ValueError("Enter a URL with a valid host.")
    except (UnicodeError, ValueError) as error:
        if isinstance(error, ValueError) and str(error).startswith(("Enter ", "URLs ")):
            raise
        raise ValueError("Enter a valid HTTP or HTTPS URL.") from None
    return url


def validate_external_link_title(value: str | None) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("Link title must be text.")
    title = value.strip()
    if len(title) > MAX_EXTERNAL_LINK_TITLE_LENGTH:
        raise ValueError(f"Link title must be at most {MAX_EXTERNAL_LINK_TITLE_LENGTH} characters.")
    if any(ord(char) < 32 or ord(char) == 127 for char in title):
        raise ValueError("Link title cannot contain control characters.")
    return title or None
