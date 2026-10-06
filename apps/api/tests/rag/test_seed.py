from pathlib import Path

import pytest

from tests.rag import seed


def test_missing_seed_file_warns_with_its_name(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(seed, "SEED_DIR", tmp_path)
    with pytest.warns(UserWarning, match="projects.json"):
        assert seed._items("projects") == []  # pyright: ignore[reportPrivateUsage]
