import logging

import structlog


def configure_logging(level: str) -> None:
    """JSON logs to stdout so Alloy/Loki can parse them without a pipeline stage."""
    numeric = logging.getLevelNamesMapping()[level.upper()]
    logging.basicConfig(level=numeric, format="%(message)s", force=True)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(numeric),
        cache_logger_on_first_use=True,
    )
