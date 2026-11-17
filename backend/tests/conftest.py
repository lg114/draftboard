"""
Pytest global configuration and fixtures.
Loads .env automatically so integration tests have access to API keys.
"""

from dotenv import load_dotenv

load_dotenv()
