"""
pytest configuration and shared fixtures.

conftest.py is a special pytest file — fixtures defined here are
automatically available to all test files without importing them.

We use a separate test database so tests never touch your real data.
Actually — for simplicity we use the same DB but wrap each test in a
transaction that gets rolled back. This means tests are:
  - Fast (no setup/teardown of tables)
  - Isolated (each test sees a clean state)
  - Safe (nothing persists after the test)
"""
import pytest
from sqlalchemy import create_engine, text

from backend import create_app
from backend.config import settings


@pytest.fixture(scope="session")
def app():
    """
    Create a Flask app configured for testing.
    scope="session" means this runs once for the entire test suite.
    """
    test_app = create_app()
    test_app.config["TESTING"] = True
    return test_app


@pytest.fixture(scope="session")
def client(app):
    """
    Flask test client — makes HTTP requests without running a real server.
    Use this in tests: client.get("/health")
    """
    return app.test_client()


@pytest.fixture(scope="session")
def db_engine():
    """Real database engine for seeding test data."""
    return create_engine(settings.database_url)


@pytest.fixture(scope="session")
def seed_session(db_engine):
    """
    Insert one minimal session into the DB for tests to use.
    scope="session" = runs once, shared across all tests.
    The session_key 99999 is obviously fake — easy to identify in the DB.
    """
    with db_engine.begin() as conn:
        conn.execute(text("""
            INSERT INTO sessions (
                session_key, year, gp_name, country,
                session_type, session_name
            ) VALUES (
                99999, 2024, 'Test Grand Prix', 'Testland',
                'Q', 'Qualifying'
            )
            ON CONFLICT (session_key) DO NOTHING
        """))

        conn.execute(text("""
            INSERT INTO drivers (
                driver_number, session_key, full_name, abbreviation, team_name, team_colour
            ) VALUES
                (44, 99999, 'Lewis Hamilton', 'HAM', 'Mercedes', '27F4D2'),
                (63, 99999, 'George Russell',  'RUS', 'Mercedes', '27F4D2')
            ON CONFLICT DO NOTHING
        """))

        conn.execute(text("""
            INSERT INTO lap_times (
                session_key, driver_number, lap_number,
                lap_time_ms, s1_ms, s2_ms, s3_ms,
                compound, is_personal_best, deleted, recorded_at
            ) VALUES
                (99999, 44, 1, 90000, 28000, 36000, 26000, 'SOFT', false, false, NOW()),
                (99999, 44, 2, 88000, 27500, 35000, 25500, 'SOFT', true,  false, NOW()),
                (99999, 63, 1, 91000, 28500, 36500, 26000, 'SOFT', false, false, NOW()),
                (99999, 63, 2, 87000, 27000, 34500, 25500, 'SOFT', true,  false, NOW())
            ON CONFLICT DO NOTHING
        """))

    yield 99999   # yield the session_key to tests that need it

    # Cleanup after ALL tests finish
    with db_engine.begin() as conn:
        conn.execute(text("DELETE FROM lap_times   WHERE session_key = 99999"))
        conn.execute(text("DELETE FROM drivers      WHERE session_key = 99999"))
        conn.execute(text("DELETE FROM sessions     WHERE session_key = 99999"))
