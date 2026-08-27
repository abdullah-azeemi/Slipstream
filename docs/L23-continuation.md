# L23 Continuation — Where You Left Off

You completed: types.py (all contracts), tools.py up through `_compute_stint_degradation` helper.
You have 8 unit tests passing for anomaly detection and degradation regression.

## What's Left (pick up from here)

---

## Part 2 continued: finish `stint_degradation_scanner` tool function

In `apps/backend/src/backend/agent/tools.py`, append AFTER `_compute_stint_degradation`:

```python
def stint_degradation_scanner(
    inp: types.StintDegradationInput,
) -> types.StintDegradationResult:
    """Scan all stints (or one specific stint) for a driver and compute degradation slopes.

    Flow:
    1. SQL gathers all laps for the driver
    2. Python groups by stint, fits a line per stint, detects cliffs
    3. Returns which stint degraded the most
    """
    with extensions.engine.connect() as conn:
        rows = (
            conn.execute(
                text(
                    """
                    SELECT
                        lap_number, lap_time_ms, compound, stint,
                        pit_in_time_ms, pit_out_time_ms
                    FROM lap_times
                    WHERE session_key = :sk
                      AND driver_number = :dn
                      AND deleted = FALSE
                    ORDER BY lap_number ASC
                    """
                ),
                {"sk": inp.session_key, "dn": inp.driver_number},
            )
            .mappings()
            .all()
        )

    if not rows:
        raise types.NotFoundError(
            f"no laps found for driver {inp.driver_number} in session {inp.session_key}"
        )

    all_stints = _compute_stint_degradation([dict(r) for r in rows])

    if inp.stint_index is not None:
        all_stints = [s for s in all_stints if s.stint_index == inp.stint_index]

    worst = None
    worst_slope = -float("inf")
    for s in all_stints:
        if s.degradation_slope_ms_per_lap > worst_slope:
            worst_slope = s.degradation_slope_ms_per_lap
            worst = s.stint_index

    return types.StintDegradationResult(
        session_key=inp.session_key,
        driver_number=inp.driver_number,
        stints=tuple(all_stints),
        worst_degradation_stint=worst,
    )
```

---

## Part 2 continued: `telemetry_inspector` + helpers

Append AFTER `stint_degradation_scanner` in tools.py:

```python
def _read_artifact_full_channels(
    artifact: types.TelemetryArtifact,
) -> list[dict]:
    """Read ALL telemetry channels from a Parquet artifact. Returns list of dicts.

    This is different from _read_artifact_speed_samples which only pulls speed_kmh.
    The telemetry_inspector needs speed, throttle, brake, gear, drs, x, y for charts.
    """
    import pyarrow.parquet as pq

    if artifact.storage_backend == "local" and artifact.format == "parquet":
        path = Path(settings.telemetry_artifact_dir) / artifact.storage_key
        if not path.exists():
            raise types.DataError(f"artifact file not found: {path}")
        table = pq.read_parquet(path)

    elif artifact.storage_backend == "local" and artifact.format == "json.gz":
        path = Path(settings.telemetry_artifact_dir) / artifact.storage_key
        if not path.exists():
            raise types.DataError(f"artifact file not found: {path}")
        with gzip.open(path, "rb") as f:
            payload = json.loads(f.read().decode("utf-8"))
        return payload.get("samples", [])

    elif artifact.storage_backend == "r2" and artifact.format == "parquet":
        import boto3

        client = boto3.client(
            "s3",
            endpoint_url=settings.r2_endpoint_url,
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            region_name="auto",
        )
        obj = client.get_object(
            Bucket=settings.telemetry_artifact_bucket,
            Key=artifact.storage_key,
        )
        table = pq.read_table(io.BytesIO(obj["Body"].read()))
    else:
        raise types.DataError(
            f"unsupported artifact: {artifact.storage_backend}/{artifact.format}"
        )

    columns_wanted = [
        "distance_m", "speed_kmh", "throttle",
        "brake", "gear", "drs", "x_pos", "y_pos",
    ]
    available = [c for c in columns_wanted if c in table.column_names]
    rows = []
    for i in range(len(table)):
        row = {}
        for col in available:
            val = table.column(col)[i].as_py()
            row[col] = val
        rows.append(row)
    return rows


def _resample_telemetry(
    samples: list[dict], max_points: int
) -> list[types.TelemetrySamplePoint]:
    """Downsample raw telemetry to at most max_points by uniform distance stride.

    Raw telemetry has ~18,000 samples per lap (one per ~0.3m).
    We pick every Nth sample uniformly over distance so the shape of the trace
    is preserved while the payload stays under 50KB.
    """
    if not samples:
        return []

    sorted_s = sorted(samples, key=lambda s: s.get("distance_m", 0.0))
    total_distance = sorted_s[-1].get("distance_m", 0.0) - sorted_s[0].get("distance_m", 0.0)

    if total_distance <= 0 or len(sorted_s) <= max_points:
        return [_to_sample_point(s) for s in sorted_s]

    stride = total_distance / max_points
    result = []
    next_boundary = sorted_s[0].get("distance_m", 0.0)
    closest = sorted_s[0]
    closest_dist = float("inf")

    for s in sorted_s:
        d = s.get("distance_m", 0.0)
        dist_to_boundary = abs(d - next_boundary)
        if dist_to_boundary < closest_dist:
            closest = s
            closest_dist = dist_to_boundary
        if d >= next_boundary:
            result.append(_to_sample_point(closest))
            next_boundary += stride
            closest = s
            closest_dist = float("inf")

    last = _to_sample_point(sorted_s[-1])
    if not result or result[-1].distance_m != last.distance_m:
        result.append(last)

    return result[:max_points]


def _to_sample_point(raw: dict) -> types.TelemetrySamplePoint:
    """Convert a raw dict from Parquet/JSON into a frozen TelemetrySamplePoint."""
    throttle = raw.get("throttle", 0.0) or 0.0
    if throttle <= 1.0:
        throttle = throttle * 100.0

    return types.TelemetrySamplePoint(
        distance_m=float(raw.get("distance_m", 0.0) or 0.0),
        speed_kmh=float(raw.get("speed_kmh", 0.0) or 0.0),
        throttle_pct=round(throttle, 1),
        brake=bool(raw.get("brake", False)),
        gear=int(raw.get("gear", 0) or 0),
        drs=int(raw.get("drs", 0) or 0),
        x_pos=raw.get("x_pos"),
        y_pos=raw.get("y_pos"),
    )


def _compute_trace_stats(
    samples: list[types.TelemetrySamplePoint],
) -> tuple[float, int]:
    """Compute full_throttle_pct and heavy_braking_zones_count from resampled samples."""
    if not samples:
        return 0.0, 0

    total_d = samples[-1].distance_m - samples[0].distance_m
    if total_d <= 0:
        return 0.0, 0
    throttle_d = sum(
        samples[i + 1].distance_m - samples[i].distance_m
        for i in range(len(samples) - 1)
        if samples[i].throttle_pct >= 99.0
    )
    full_throttle_pct = round(throttle_d / total_d * 100, 1)

    braking_zones = 0
    prev_brake = False
    for s in samples:
        if s.brake and not prev_brake:
            braking_zones += 1
        prev_brake = s.brake

    return full_throttle_pct, braking_zones


def telemetry_inspector(
    inp: types.TelemetryInspectorInput,
) -> types.TelemetryInspectorResult:
    """Fetch and resample full telemetry for requested laps.

    Flow:
    1. For each requested lap, find the artifact metadata from DB
    2. Read all channels from the Parquet/JSON file
    3. Resample to <= max_samples_per_lap points
    4. Compute summary stats (full throttle %, braking zones)
    5. Return TelemetryInspectorResult
    """
    all_lap_requests = set(inp.lap_numbers)
    all_driver_laps: dict[int, list[int]] = {inp.driver_number: list(inp.lap_numbers)}
    if inp.compare_driver_number is not None:
        all_lap_requests |= set(inp.compare_lap_numbers)
        all_driver_laps[inp.compare_driver_number] = list(inp.compare_lap_numbers)

    artifacts_by_key: dict[tuple[int, int], types.TelemetryArtifact] = {}
    for drv_num, laps in all_driver_laps.items():
        result = get_lap_telemetry_artifacts(
            types.GetLapTelemetryArtifactsInput(
                session_key=inp.session_key,
                driver_number=drv_num,
                lap_numbers=tuple(laps),
            )
        )
        for a in result.artifacts:
            artifacts_by_key[(a.driver_number, a.lap_number)] = a

    abbrev_map: dict[int, str] = {}
    with extensions.engine.connect() as conn:
        drv_rows = (
            conn.execute(
                text(
                    "SELECT driver_number, abbreviation FROM drivers "
                    "WHERE session_key = :sk AND driver_number = ANY(:dns)"
                ),
                {
                    "sk": inp.session_key,
                    "dns": list(all_driver_laps.keys()),
                },
            )
            .mappings()
            .all()
        )
        for r in drv_rows:
            abbrev_map[r["driver_number"]] = r["abbreviation"]

    traces: list[types.TelemetryLapTrace] = []
    for drv_num, laps in all_driver_laps.items():
        for lap_num in laps:
            artifact = artifacts_by_key.get((drv_num, lap_num))
            if artifact is None:
                continue

            raw_samples = _read_artifact_full_channels(artifact)
            resampled = _resample_telemetry(raw_samples, inp.max_samples_per_lap)
            traces.append(
                types.TelemetryLapTrace(
                    driver_number=drv_num,
                    driver_abbreviation=abbrev_map.get(drv_num, "???"),
                    lap_number=lap_num,
                    samples=tuple(resampled),
                )
            )

    if not traces:
        raise types.DataError(
            "no telemetry artifacts found for any of the requested laps"
        )

    primary = traces[0]
    full_throttle_pct, braking_zones = _compute_trace_stats(list(primary.samples))

    apex_delta = None
    if len(traces) >= 2:
        speed_a = [s.speed_kmh for s in primary.samples if s.speed_kmh > 0]
        speed_b = [s.speed_kmh for s in traces[1].samples if s.speed_kmh > 0]
        if speed_a and speed_b:
            apex_delta = round(min(speed_b) - min(speed_a), 2)

    return types.TelemetryInspectorResult(
        session_key=inp.session_key,
        traces=tuple(traces),
        speed_delta_apex_kmh=apex_delta,
        full_throttle_pct=full_throttle_pct,
        heavy_braking_zones_count=braking_zones,
    )
```

---

## Part 3: Unit Tests to Append

Append to `apps/backend/tests/test_agent_tools.py` (after line 235):

```python
# ── inspect_lap_events (pure helper tests) ─────────────────────────────────


def _make_lap_event(
    lap_number,
    lap_time_ms=None,
    pit_in=False,
    pit_out=False,
    rainfall=False,
    track_status=None,
    compound="MEDIUM",
    stint=1,
):
    """Helper to build a LapEvent for testing without typing every field."""
    return types.LapEvent(
        lap_number=lap_number,
        lap_time_ms=lap_time_ms,
        delta_to_median_ms=None,
        sector_1_ms=None,
        sector_2_ms=None,
        sector_3_ms=None,
        compound=compound,
        stint=stint,
        is_pit_in=pit_in,
        is_pit_out=pit_out,
        is_anomaly=False,
        anomaly_reason=None,
        rainfall=rainfall,
        track_status=track_status,
    )


def test_detect_lap_anomalies_flags_slow_laps():
    """A lap 5s slower than median should be flagged."""
    median_ms = 90000
    events = [
        _make_lap_event(1, lap_time_ms=90000),
        _make_lap_event(2, lap_time_ms=95000),
        _make_lap_event(3, lap_time_ms=91000),
    ]
    flagged = tools._detect_lap_anomalies(events, median_ms)

    assert flagged[0].is_anomaly is False
    assert flagged[1].is_anomaly is True
    assert flagged[2].is_anomaly is False


def test_detect_lap_anomalies_classifies_pit_stop():
    """A slow lap with pit_in=True should be classified as pit_stop."""
    events = [
        _make_lap_event(10, lap_time_ms=115000, pit_in=True),
    ]
    flagged = tools._detect_lap_anomalies(events, 90000)

    assert flagged[0].is_anomaly is True
    assert flagged[0].anomaly_reason == "pit_stop"


def test_detect_lap_anomalies_classifies_yellow_flag():
    """A slow lap with track_status=4 (VSC) should be classified as yellow_flag_vsc."""
    events = [
        _make_lap_event(20, lap_time_ms=100000, track_status="4"),
    ]
    flagged = tools._detect_lap_anomalies(events, 90000)

    assert flagged[0].anomaly_reason == "yellow_flag_vsc"


def test_detect_lap_anomalies_classifies_rain_onset():
    """First rainy lap after dry laps should be classified as rain_onset."""
    events = [
        _make_lap_event(1, lap_time_ms=90000, rainfall=False),
        _make_lap_event(2, lap_time_ms=95000, rainfall=True),
    ]
    flagged = tools._detect_lap_anomalies(events, 90000)

    assert flagged[1].anomaly_reason == "rain_onset"


# ── stint_degradation_scanner (pure helper tests) ───────────────────────────


def test_compute_stint_degradation_positive_slope():
    """Lap times getting slower (positive slope) = degradation."""
    laps = [
        {"lap_number": 5, "lap_time_ms": 90000, "compound": "MEDIUM", "stint": 1,
         "pit_in_time_ms": None, "pit_out_time_ms": None},
        {"lap_number": 6, "lap_time_ms": 90500, "compound": "MEDIUM", "stint": 1,
         "pit_in_time_ms": None, "pit_out_time_ms": None},
        {"lap_number": 7, "lap_time_ms": 91000, "compound": "MEDIUM", "stint": 1,
         "pit_in_time_ms": None, "pit_out_time_ms": None},
        {"lap_number": 8, "lap_time_ms": 91500, "compound": "MEDIUM", "stint": 1,
         "pit_in_time_ms": None, "pit_out_time_ms": None},
    ]
    stints = tools._compute_stint_degradation(laps)

    assert len(stints) == 1
    assert stints[0].degradation_slope_ms_per_lap == 500.0
    assert stints[0].cliff_detected is False


def test_compute_stint_degradation_detects_cliff():
    """A sudden spike > 2.5 std above the regression = cliff."""
    laps = [
        {"lap_number": 10, "lap_time_ms": 90000, "compound": "SOFT", "stint": 2,
         "pit_in_time_ms": None, "pit_out_time_ms": None},
        {"lap_number": 11, "lap_time_ms": 90100, "compound": "SOFT", "stint": 2,
         "pit_in_time_ms": None, "pit_out_time_ms": None},
        {"lap_number": 12, "lap_time_ms": 90200, "compound": "SOFT", "stint": 2,
         "pit_in_time_ms": None, "pit_out_time_ms": None},
        {"lap_number": 13, "lap_time_ms": 90300, "compound": "SOFT", "stint": 2,
         "pit_in_time_ms": None, "pit_out_time_ms": None},
        {"lap_number": 14, "lap_time_ms": 96000, "compound": "SOFT", "stint": 2,
         "pit_in_time_ms": None, "pit_out_time_ms": None},
    ]
    stints = tools._compute_stint_degradation(laps)

    assert len(stints) == 1
    assert stints[0].cliff_detected is True
    assert stints[0].cliff_lap == 14


def test_compute_stint_degradation_skips_pit_laps():
    """Pit in/out laps should be excluded from regression."""
    laps = [
        {"lap_number": 20, "lap_time_ms": 90000, "compound": "HARD", "stint": 3,
         "pit_in_time_ms": None, "pit_out_time_ms": None},
        {"lap_number": 21, "lap_time_ms": 110000, "compound": "HARD", "stint": 3,
         "pit_in_time_ms": 1.0, "pit_out_time_ms": None},
        {"lap_number": 22, "lap_time_ms": 95000, "compound": "HARD", "stint": 3,
         "pit_in_time_ms": None, "pit_out_time_ms": 2.0},
        {"lap_number": 23, "lap_time_ms": 90500, "compound": "HARD", "stint": 3,
         "pit_in_time_ms": None, "pit_out_time_ms": None},
    ]
    stints = tools._compute_stint_degradation(laps)

    assert len(stints) == 1
    assert stints[0].total_laps == 2


def test_compute_stint_degradation_multiple_stints():
    """Different stints should produce separate summaries."""
    laps = [
        {"lap_number": 1, "lap_time_ms": 90000, "compound": "SOFT", "stint": 1,
         "pit_in_time_ms": None, "pit_out_time_ms": None},
        {"lap_number": 2, "lap_time_ms": 90500, "compound": "SOFT", "stint": 1,
         "pit_in_time_ms": None, "pit_out_time_ms": None},
        {"lap_number": 10, "lap_time_ms": 91000, "compound": "HARD", "stint": 2,
         "pit_in_time_ms": None, "pit_out_time_ms": None},
        {"lap_number": 11, "lap_time_ms": 91200, "compound": "HARD", "stint": 2,
         "pit_in_time_ms": None, "pit_out_time_ms": None},
    ]
    stints = tools._compute_stint_degradation(laps)

    assert len(stints) == 2
    assert stints[0].stint_index == 1
    assert stints[0].compound == "SOFT"
    assert stints[1].stint_index == 2
    assert stints[1].compound == "HARD"


# ── telemetry_inspector (pure helper tests) ──────────────────────────────────


def test_resample_telemetry_reduces_points():
    """1000 samples should be downsampled to <= max_points."""
    samples = [
        {"distance_m": i * 1.0, "speed_kmh": 200.0, "throttle": 1.0,
         "brake": False, "gear": 7, "drs": 1}
        for i in range(1000)
    ]
    result = tools._resample_telemetry(samples, max_points=100)

    assert len(result) <= 100
    assert isinstance(result[0], types.TelemetrySamplePoint)


def test_resample_telemetry_preserves_first_and_last():
    """First and last points should always be in the result."""
    samples = [
        {"distance_m": 0.0, "speed_kmh": 100.0, "throttle": 0.5,
         "brake": False, "gear": 1, "drs": 0},
        {"distance_m": 100.0, "speed_kmh": 200.0, "throttle": 1.0,
         "brake": False, "gear": 8, "drs": 1},
    ]
    result = tools._resample_telemetry(samples, max_points=600)

    assert len(result) == 2
    assert result[0].distance_m == 0.0
    assert result[-1].distance_m == 100.0


def test_to_sample_point_scales_throttle():
    """throttle=0.8 from fastf1 should become 80.0%."""
    raw = {"distance_m": 100.0, "speed_kmh": 250.0, "throttle": 0.8,
           "brake": False, "gear": 8, "drs": 1}
    pt = tools._to_sample_point(raw)

    assert pt.throttle_pct == 80.0
    assert pt.speed_kmh == 250.0
    assert pt.gear == 8


def test_compute_trace_stats_counts_braking_zones():
    """Three separate brake zones should yield braking_zones_count=3."""
    samples = [
        types.TelemetrySamplePoint(0.0, 300.0, 100.0, False, 8, 1, None, None),
        types.TelemetrySamplePoint(100.0, 300.0, 100.0, False, 8, 1, None, None),
        types.TelemetrySamplePoint(200.0, 100.0, 0.0, True, 3, 0, None, None),
        types.TelemetrySamplePoint(300.0, 300.0, 100.0, False, 8, 1, None, None),
        types.TelemetrySamplePoint(400.0, 100.0, 0.0, True, 3, 0, None, None),
        types.TelemetrySamplePoint(500.0, 300.0, 100.0, False, 8, 1, None, None),
        types.TelemetrySamplePoint(600.0, 100.0, 0.0, True, 3, 0, None, None),
    ]
    throttle_pct, braking_zones = tools._compute_trace_stats(samples)

    assert braking_zones == 3
    assert throttle_pct > 0
```

---

## Part 4: Orchestrator tweak

In `apps/backend/src/backend/agent/orchestrator.py`, line 320, change the unsupported answer text:

```python
# BEFORE (line 320):
            answer="I cannot answer that yet. v1 only supports the pit-stop speed question.",

# AFTER:
            answer="I cannot answer that yet. v1 supports pit-stop, lap event, tyre degradation, and telemetry comparison questions.",
```

---

## Verification Commands

```bash
cd apps/backend
uv run ruff check apps/backend/src/backend/agent/
uv run ruff format --check apps/backend/src/backend/agent/
uv run pytest apps/backend/tests/test_agent_tools.py -v
```

## Final Commit Message

```
feat(agent): add inspect_lap_events, stint_degradation_scanner, telemetry_inspector tools

- New Intent values: LAP_EVENT_INVESTIGATION, TYRE_DEGRADATION_ANALYSIS, TELEMETRY_COMPARISON
- New ToolName values: INSPECT_LAP_EVENTS, STINT_DEGRADATION_SCANNER, TELEMETRY_INSPECTOR
- inspect_lap_events: SQL gathers laps+weather, Python computes median, flags >3s anomalies,
  classifies pit_stop/rain_onset/yellow_flag
- stint_degradation_scanner: OLS linear regression per stint, cliff detection at 2.5σ
- telemetry_inspector: reads full Parquet channels, resamples to ≤600 points,
  computes full_throttle_pct and heavy_braking_zones_count
- 14 new unit tests for pure helpers
```
