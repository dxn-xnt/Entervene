import logging
import os
import smtplib
import time
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.core.Config import settings
from app.db.Session import SessionLocal
from app.models.auth.UserAccount import UserAccount

logger = logging.getLogger("invitation")
logger.setLevel(logging.DEBUG)

_handler = logging.StreamHandler()
_handler.setFormatter(logging.Formatter("%(message)s"))
if not logger.handlers:
    logger.addHandler(_handler)


def _build_invitation_message(email: str, token: str, frontend_url: str, from_name: str, smtp_user: str) -> MIMEMultipart:
    link = f"{frontend_url}/setup-password?token={token}"
    msg = MIMEMultipart("alternative")
    msg["Subject"] = "Welcome to Entervene - Set Up Your Account"
    msg["From"] = f"{from_name} <{smtp_user}>"
    msg["To"] = email

    text_body = (
        f"Hello,\n\n"
        f"You have been invited to join the Entervene Academic Platform.\n\n"
        f"Please visit the following link to create your password and activate your account (valid for 48 hours):\n"
        f"{link}\n\n"
        f"If you did not expect this invitation, you can safely ignore this email.\n\n"
        f"— Entervene Academic Team"
    )

    html_body = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Entervene</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f4f4f0; padding: 40px 15px;">
    <tr>
      <td align="center">
        <table width="100%" max-width="540" style="max-width: 540px; background-color: #ffffff; border: 3px solid #000000; box-shadow: 6px 6px 0px #000000; border-radius: 4px; overflow: hidden;" border="0" cellspacing="0" cellpadding="0">
          <!-- Header banner -->
          <tr>
            <td style="background-color: #fef08a; padding: 24px; border-bottom: 3px solid #000000; text-align: left;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 900; color: #000000; letter-spacing: -0.5px;">ENTERVENE</h1>
              <p style="margin: 4px 0 0 0; font-size: 13px; font-weight: 700; color: #713f12;">Academic Management & Intervention Platform</p>
            </td>
          </tr>
          <!-- Body content -->
          <tr>
            <td style="padding: 32px 28px; text-align: left;">
              <h2 style="margin: 0 0 12px 0; font-size: 18px; font-weight: 800; color: #000000;">You're invited to Entervene!</h2>
              <p style="margin: 0 0 18px 0; font-size: 14px; line-height: 1.6; color: #374151;">
                An administrator has created an account for you. To get started, please click the button below to set up your password and activate your account.
              </p>

              <!-- Call to Action Button -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 24px 0;">
                <tr>
                  <td align="center">
                    <a href="{link}" target="_blank" style="display: inline-block; background-color: #10b981; color: #000000; font-size: 14px; font-weight: 800; text-decoration: none; padding: 14px 28px; border: 2px solid #000000; box-shadow: 3px 3px 0px #000000; border-radius: 4px;">
                      Set Up Password & Activate Account &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <div style="background-color: #f9fafb; border: 1px solid #d1d5db; padding: 12px 16px; border-radius: 4px; margin-top: 20px;">
                <p style="margin: 0; font-size: 12px; color: #6b7280; line-height: 1.5;">
                  <strong>Note:</strong> This invitation link is valid for <strong>48 hours</strong>.<br>
                  If the button above does not work, copy and paste this link into your browser:<br>
                  <a href="{link}" style="color: #2563eb; word-break: break-all; font-size: 11px;">{link}</a>
                </p>
              </div>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 16px 28px; border-top: 2px solid #e5e7eb; text-align: center;">
              <p style="margin: 0; font-size: 11px; color: #9ca3af;">
                If you did not expect this invitation, you can safely ignore this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""

    msg.attach(MIMEText(text_body, "plain"))
    msg.attach(MIMEText(html_body, "html"))
    return msg


def _update_user_email_status(user_id_val: str | None, status: str) -> None:
    """Updates user_account.email_status using an independent, thread-safe database session."""
    if not user_id_val:
        return
    try:
        with SessionLocal() as db:
            acc = db.query(UserAccount).filter(UserAccount.user_id == user_id_val).first()
            if acc:
                acc.email_status = status
                db.commit()
    except Exception as exc:
        logger.error(f"Failed to update email_status to '{status}' for user {user_id_val}: {exc}")


def send_invitation_email(email: str, token: str) -> None:
    """
    Sends a single account invitation email with a secure setup link.
    Supports real SMTP delivery (e.g. Gmail) and console logging.
    Preserves exact backwards compatibility with all callers.
    """
    frontend_url = (getattr(settings, "frontend_url", None) or os.getenv("FRONTEND_URL", "http://localhost:5173")).rstrip("/")
    link = f"{frontend_url}/setup-password?token={token}"

    logger.info(
        "\n"
        "+------------------------------------------------------------+\n"
        "| INVITATION LINK GENERATED                                  |\n"
        "+------------------------------------------------------------+\n"
        f"| To   : {email}\n"
        f"| Link : {link}\n"
        "+------------------------------------------------------------+"
    )

    mail_driver = (os.getenv("MAIL_DRIVER") or getattr(settings, "mail_driver", "console")).lower()
    if mail_driver == "console":
        logger.info("[MailService] MAIL_DRIVER is set to 'console'. Skipping SMTP delivery.")
        return

    smtp_host = os.getenv("SMTP_HOST") or getattr(settings, "smtp_host", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT") or getattr(settings, "smtp_port", 587))
    smtp_user = os.getenv("SMTP_USER") or getattr(settings, "smtp_user", None)
    smtp_pass = os.getenv("SMTP_PASSWORD") or getattr(settings, "smtp_password", None)
    from_name = os.getenv("MAIL_FROM_NAME") or getattr(settings, "mail_from_name", "Entervene Academic Portal")

    if not smtp_user or not smtp_pass:
        logger.warning(f"SMTP_USER or SMTP_PASSWORD not configured. Skipping real email delivery to {email}.")
        return

    msg = _build_invitation_message(email, token, frontend_url, from_name, smtp_user)

    try:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as server:
            server.starttls()
            server.login(smtp_user, smtp_pass)
            server.sendmail(smtp_user, [email], msg.as_string())
        logger.info(f"Successfully sent invitation email to {email}")
    except Exception as exc:
        logger.error(f"Failed to send email to {email} via SMTP: {exc}")
        raise


def send_batch_invitations(items: list[dict], delay_seconds: float = 0.35) -> dict[str, list[str]]:
    """
    Synchronous batch sender designed to run in Starlette/FastAPI's worker threadpool.
    Reuses a single authenticated SMTP connection across all recipients.
    Inserts a small delay (0.35s) between sends to respect provider burst quotas.
    Isolates errors per recipient and persists delivery status using independent DB sessions.

    :param items: List of dicts with keys 'email', 'token', and optional 'user_id'.
    :param delay_seconds: Delay between consecutive sends.
    :return: Dict of {'sent': list[str], 'failed': list[str]}
    """
    frontend_url = (os.getenv("FRONTEND_URL") or getattr(settings, "frontend_url", "http://localhost:5173")).rstrip("/")
    mail_driver = (os.getenv("MAIL_DRIVER") or getattr(settings, "mail_driver", "console")).lower()

    sent: list[str] = []
    failed: list[str] = []

    if not items:
        return {"sent": sent, "failed": failed}

    # If console mode, log all generated links and mark users as sent
    if mail_driver == "console":
        for item in items:
            email = item["email"]
            token = item["token"]
            user_id = item.get("user_id")
            link = f"{frontend_url}/setup-password?token={token}"
            logger.info(f"[Local Console] Invitation for {email}: {link}")
            _update_user_email_status(user_id, "sent")
            sent.append(email)
        return {"sent": sent, "failed": failed}

    smtp_host = os.getenv("SMTP_HOST") or getattr(settings, "smtp_host", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT") or getattr(settings, "smtp_port", 587))
    smtp_user = os.getenv("SMTP_USER") or getattr(settings, "smtp_user", None)
    smtp_pass = os.getenv("SMTP_PASSWORD") or getattr(settings, "smtp_password", None)
    from_name = os.getenv("MAIL_FROM_NAME") or getattr(settings, "mail_from_name", "Entervene Academic Portal")

    if not smtp_user or not smtp_pass:
        logger.warning("SMTP credentials not configured. Marking batch as failed.")
        for item in items:
            _update_user_email_status(item.get("user_id"), "failed")
            failed.append(item["email"])
        return {"sent": sent, "failed": failed}

    # Open ONE SMTP connection for the entire batch
    server = None
    try:
        server = smtplib.SMTP(smtp_host, smtp_port, timeout=25)
        server.starttls()
        server.login(smtp_user, smtp_pass)
        logger.info(f"Connected to SMTP {smtp_host}:{smtp_port}. Dispatching {len(items)} invitation(s)...")
    except Exception as conn_err:
        logger.error(f"Failed to authenticate with SMTP server for batch: {conn_err}")
        for item in items:
            _update_user_email_status(item.get("user_id"), "failed")
            failed.append(item["email"])
        return {"sent": sent, "failed": failed}

    try:
        for idx, item in enumerate(items):
            email = item["email"]
            token = item["token"]
            user_id = item.get("user_id")

            try:
                msg = _build_invitation_message(email, token, frontend_url, from_name, smtp_user)
                server.sendmail(smtp_user, [email], msg.as_string())
                _update_user_email_status(user_id, "sent")
                sent.append(email)
                logger.info(f"[{idx + 1}/{len(items)}] Sent invitation email to {email}")
            except Exception as send_err:
                logger.error(f"[{idx + 1}/{len(items)}] Failed sending to {email}: {send_err}")
                _update_user_email_status(user_id, "failed")
                failed.append(email)

            if delay_seconds > 0 and idx < len(items) - 1:
                time.sleep(delay_seconds)
    finally:
        if server:
            try:
                server.quit()
            except Exception:
                pass

    logger.info(f"Batch invitation completed. Sent: {len(sent)}, Failed: {len(failed)}")
    return {"sent": sent, "failed": failed}


