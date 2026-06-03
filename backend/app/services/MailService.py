import logging
import os

logger = logging.getLogger("invitation")
logger.setLevel(logging.DEBUG)

_handler = logging.StreamHandler()
_handler.setFormatter(logging.Formatter("%(message)s"))
if not logger.handlers:
    logger.addHandler(_handler)


def send_invitation_email(email: str, token: str) -> None:
    """
    Local development logs the invitation link to the console.
    Production should replace the else block with a real email provider.
    """
    app_env = os.getenv("APP_ENV", "local").lower()
    mail_driver = os.getenv("MAIL_DRIVER", "console").lower()

    if app_env == "local" or mail_driver == "console":
        link = f"http://localhost:5173/setup-password?token={token}"
        logger.info(
            "\n"
            "+------------------------------------------------------------+\n"
            "| INVITATION EMAIL (LOCAL DEV)                              |\n"
            "+------------------------------------------------------------+\n"
            f"| To   : {email}\n"
            f"| Link : {link}\n"
            "+------------------------------------------------------------+"
        )
        return

    # TODO: replace with a production provider such as Resend, SendGrid, or SMTP.
    # e.g. resend.emails.send({ "to": email, "subject": "...", "html": ... })
    raise NotImplementedError("Production mail not configured yet.")
