"""Unit tests for the pure (DB-free) agent tool helpers."""

from backend.agent import tools


def _lap(lap_number, pit_in=None, pit_out=None, compound=None):
    return {
        "lap_number": lap_number,
        "pit_in_time_ms": pit_in,
        "pit_out_time_ms": pit_out,
        "compound": compound,
    }


def test_derive_pit_stops_handles_single_stop():
    laps = [
        _lap(1, compound="MEDIUM"),
        _lap(2, compound="MEDIUM"),
        _lap(3, pit_in=123456.0, compound="MEDIUM"),
        _lap(4, pit_out=234567.0, compound="HARD"),
        _lap(5, compound="HARD"),
    ]
    stops = tools._derive_pit_stops(laps)

    assert len(stops) == 1
    assert stops[0].stop_index == 1
    assert stops[0].pit_in_lap == 3
    assert stops[0].pit_out_lap == 4
    assert stops[0].compound_before == "MEDIUM"
    assert stops[0].compound_after == "HARD"


def test_derive_pit_stops_multiple_stops_are_numbered():
    laps = [
        _lap(1, compound="SOFT"),
        _lap(2, pit_in=1.0, compound="SOFT"),
        _lap(3, pit_out=2.0, compound="MEDIUM"),
        _lap(4, compound="MEDIUM"),
        _lap(5, pit_in=3.0, compound="MEDIUM"),
        _lap(6, pit_out=4.0, compound="HARD"),
    ]
    stops = tools._derive_pit_stops(laps)

    assert [s.stop_index for s in stops] == [1, 2]
    assert [s.pit_in_lap for s in stops] == [2, 5]
    assert [s.pit_out_lap for s in stops] == [3, 6]
    assert stops[1].compound_before == "MEDIUM"
    assert stops[1].compound_after == "HARD"


def test_derive_pit_stops_missing_pit_out_defaults_to_next_lap():
    laps = [
        _lap(10, compound="MEDIUM"),
        _lap(11, pit_in=1.0, compound="MEDIUM"),
    ]
    stops = tools._derive_pit_stops(laps)

    assert len(stops) == 1
    assert stops[0].pit_in_lap == 11
    assert stops[0].pit_out_lap == 12
    assert stops[0].compound_before == "MEDIUM"
    assert stops[0].compound_after is None


def test_derive_pit_stops_no_pit_laps_returns_empty():
    laps = [_lap(1, compound="SOFT"), _lap(2, compound="SOFT")]
    assert tools._derive_pit_stops(laps) == []
