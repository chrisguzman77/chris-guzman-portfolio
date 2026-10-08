from portfolio_api.services.newsletter_email import confirm_email, post_email, post_url

SENDER = "Christopher Guzman <posts@christopherguzman.me>"


def test_post_url_carries_utm_tags() -> None:
    assert post_url("https://christopherguzman.me", "how-i-built-this") == (
        "https://christopherguzman.me/blog/how-i-built-this"
        "?utm_source=newsletter&utm_medium=email&utm_campaign=how-i-built-this"
    )


def test_confirm_email() -> None:
    url = "https://christopherguzman.me/newsletter/confirm?token=abc"
    email = confirm_email(sender=SENDER, to="ada@example.com", confirm_url=url, idempotency_key="k")
    assert email.subject == "Confirm your subscription to Christopher Guzman's blog"
    assert email.sender == SENDER and email.to == "ada@example.com"
    assert url in email.text and email.html is not None
    assert f'href="{url}"' in email.html and "Confirm subscription" in email.html
    assert email.headers is None and email.reply_to is None


def test_post_email_escapes_and_links() -> None:
    email = post_email(
        sender=SENDER,
        to="ada@example.com",
        title="Tips & <tricks>",
        excerpt='Why "x" < y',
        post_url="https://christopherguzman.me/blog/t?utm_source=newsletter&utm_medium=email&utm_campaign=t",
        unsubscribe_page_url="https://christopherguzman.me/newsletter/unsubscribe?token=u.1",
        unsubscribe_api_url="https://api.christopherguzman.me/v1/newsletter/unsubscribe?token=u.1",
        idempotency_key="k",
    )
    assert email.subject == "Tips & <tricks>"
    assert email.html is not None
    assert "Tips &amp; &lt;tricks&gt;" in email.html and "<tricks>" not in email.html
    assert "utm_campaign=t" in email.html and "Read the post" in email.html
    assert "&amp;utm_medium=email" in email.html  # attribute-escaped
    assert "You're getting this because you subscribed at christopherguzman.me" in email.html
    assert "/newsletter/unsubscribe?token=u.1" in email.html
    assert email.headers == {
        "List-Unsubscribe": "<https://api.christopherguzman.me/v1/newsletter/unsubscribe?token=u.1>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    }
    assert "Read the post: https://christopherguzman.me/blog/t?" in email.text
    assert (
        "Unsubscribe: https://christopherguzman.me/newsletter/unsubscribe?token=u.1" in email.text
    )
