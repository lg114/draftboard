"""
Pytest global configuration and fixtures.
Loads .env automatically so integration tests have access to API keys.
"""

import pytest
from dotenv import load_dotenv

load_dotenv()


@pytest.fixture(scope="session")
def font_files(tmp_path_factory):
    from tests.synthetic_fonts import build_font_files

    return build_font_files(tmp_path_factory.mktemp("synthetic-fonts"))


@pytest.fixture(scope="session")
def font_pair(font_files):
    from draftboard.measure import FontMetrics, FontPair

    latin, ea = font_files
    return FontPair(latin=FontMetrics(latin), ea=FontMetrics(ea))
