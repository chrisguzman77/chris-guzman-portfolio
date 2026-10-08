"""The two newsletter emails, as plain inline-styled HTML plus a text part.

Light palette from the site (accent #0d7a57). No images, no tracking pixels, and links
are not rewritten: post links carry UTM tags only.
"""

from html import escape
from urllib.parse import quote

from portfolio_api.clients.email import OutgoingEmail

ACCENT = "#0d7a57"
CONFIRM_SUBJECT = "Confirm your subscription to Christopher Guzman's blog"
FOOTER = "You're getting this because you subscribed at christopherguzman.me"


def post_url(site_url: str, slug: str) -> str:
    s = quote(slug, safe="")
    return (
        f"{site_url.rstrip('/')}/blog/{s}?utm_source=newsletter&utm_medium=email&utm_campaign={s}"
    )


def _button(href: str, label: str) -> str:
    return (
        f'<a href="{escape(href)}" style="display:inline-block;background:{ACCENT};color:#ffffff;'
        'text-decoration:none;font-weight:600;padding:10px 16px;border-radius:6px">'
        f"{escape(label)}</a>"
    )


def _page(inner: str) -> str:
    return (
        '<!doctype html><html><body style="margin:0;background:#f4f5f7;padding:24px">'
        '<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e3e6ea;'
        "border-radius:10px;padding:24px;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;"
        f'color:#16191d;line-height:1.55">{inner}</div></body></html>'
    )


def confirm_email(*, sender: str, to: str, confirm_url: str, idempotency_key: str) -> OutgoingEmail:
    text = (
        f"{CONFIRM_SUBJECT}:\n\n{confirm_url}\n\n"
        "If you didn't ask for this, ignore this email. You won't be subscribed.\n"
    )
    html = _page(
        f'<p style="margin:0 0 16px">{escape(CONFIRM_SUBJECT, quote=False)}.</p>'
        f'<p style="margin:0 0 16px">{_button(confirm_url, "Confirm subscription")}</p>'
        '<p style="margin:0;color:#5b6470;font-size:13px">If you didn\'t ask for this, ignore '
        "this email. You won't be subscribed.</p>"
    )
    return OutgoingEmail(
        sender=sender,
        to=to,
        subject=CONFIRM_SUBJECT,
        text=text,
        html=html,
        idempotency_key=idempotency_key,
    )


def post_email(
    *,
    sender: str,
    to: str,
    title: str,
    excerpt: str,
    post_url: str,
    unsubscribe_page_url: str,
    unsubscribe_api_url: str,
    idempotency_key: str,
) -> OutgoingEmail:
    text = (
        f"{title}\n\n{excerpt}\n\nRead the post: {post_url}\n\n--\n"
        f"{FOOTER}.\nUnsubscribe: {unsubscribe_page_url}\n"
    )
    html = _page(
        f'<h1 style="margin:0 0 12px;font-size:20px">{escape(title)}</h1>'
        f'<p style="margin:0 0 20px">{escape(excerpt)}</p>'
        f'<p style="margin:0 0 24px">{_button(post_url, "Read the post")}</p>'
        '<p style="margin:0;color:#5b6470;font-size:12px;border-top:1px solid #e3e6ea;'
        f'padding-top:12px">{escape(FOOTER, quote=False)} · '
        f'<a href="{escape(unsubscribe_page_url)}" style="color:#5b6470">Unsubscribe</a></p>'
    )
    return OutgoingEmail(
        sender=sender,
        to=to,
        subject=" ".join(title.split()),
        text=text,
        html=html,
        headers={
            "List-Unsubscribe": f"<{unsubscribe_api_url}>",
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        idempotency_key=idempotency_key,
    )
