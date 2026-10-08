import hashlib
import uuid

from portfolio_api.newsletter_tokens import (
    hash_token,
    new_confirm_token,
    read_unsubscribe_token,
    unsubscribe_key,
    unsubscribe_token,
)

KEY = unsubscribe_key("s3cret")
SUB = uuid.UUID("0b6f1c1e-0000-4000-8000-000000000001")


def test_confirm_token_is_random_and_only_its_sha256_is_kept() -> None:
    token, digest = new_confirm_token()
    assert len(token) >= 43 and token != new_confirm_token()[0]
    assert digest == hashlib.sha256(token.encode()).hexdigest() == hash_token(token)


def test_unsubscribe_token_round_trips() -> None:
    token = unsubscribe_token(KEY, SUB)
    assert token.startswith(f"{SUB}.") and "=" not in token
    assert read_unsubscribe_token(KEY, token) == SUB


def test_key_is_derived_with_a_label() -> None:
    assert len(KEY) == 32 and unsubscribe_key("other") != KEY
    assert hashlib.sha256(b"s3cret").digest() != KEY


def test_forged_malformed_and_other_key_tokens_are_rejected() -> None:
    good = unsubscribe_token(KEY, SUB)
    other = uuid.UUID(int=7)
    forged = f"{other}.{good.split('.', 1)[1]}"
    for token in (
        "",
        "nope",
        forged,
        good + "x",
        good.upper(),
        unsubscribe_token(unsubscribe_key("other"), SUB),
        f"{SUB.hex}.{good.split('.', 1)[1]}",  # non-canonical uuid form
        "é." + good.split(".", 1)[1],
    ):
        assert read_unsubscribe_token(KEY, token) is None, token
