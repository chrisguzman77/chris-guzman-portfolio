from portfolio_api.clients.email import EmailSendError, OutgoingEmail


class FakeTurnstile:
    def __init__(self, result: bool | Exception = True) -> None:
        self.result = result
        self.calls: list[tuple[str, str | None]] = []

    async def verify(self, token: str, remote_ip: str | None) -> bool:
        self.calls.append((token, remote_ip))
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


class FakeSender:
    def __init__(self, fail_times: int = 0) -> None:
        self.fail_times = fail_times
        self.sent: list[OutgoingEmail] = []
        self.attempts = 0

    async def send(self, email: OutgoingEmail) -> None:
        self.attempts += 1
        if self.fail_times > 0:
            self.fail_times -= 1
            raise EmailSendError("resend 500: boom")
        self.sent.append(email)
