"""
Data retention policy.

Raw telemetry: kept 7 days (TimescaleDB retention policy handles this automatically)
lap_telemetry_stats: kept forever (pre-computed, small)
lap_times: kept forever
ML predictions: kept forever

This task is a manual override for immediate purges and reporting.
"""
from __future__ import annotations
from workers.celery_app import app
from workers.config import settings
import structlog

log = structlog.get_logger()


def get_engine():
    from sqlalchemy import create_engine
    return create_engine(settings.database_url)


@app.task(name='workers.tasks.retention.purge_telemetry')
def purge_telemetry(days: int = 7):
    """
    Manually purge telemetry older than `days` days.
    TimescaleDB retention policy runs this automatically,
    but this task allows manual triggering and reporting.
    """
    from sqlalchemy import text
    engine = get_engine()

    with engine.connect() as conn:
        # Count before delete
        before = conn.execute(text(
            "SELECT COUNT(*) FROM telemetry"
        )).scalar()

        # Delete rows older than cutoff
        deleted = conn.execute(text(f"""
            DELETE FROM telemetry
            WHERE recorded_at < NOW() - INTERVAL '{days} days'
        """)).rowcount

        conn.commit()

        after = conn.execute(text(
            "SELECT COUNT(*) FROM telemetry"
        )).scalar()

    log.info("retention.purged",
             deleted=deleted,
             before=before,
             after=after,
             days=days)

    return {
        "deleted":  deleted,
        "before":   before,
        "after":    after,
        "days":     days,
    }


@app.task(name='workers.tasks.retention.storage_report')
def storage_report():
    """Report current storage usage per table."""
    from sqlalchemy import text
    engine = get_engine()

    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT
                relname AS table_name,
                pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
                pg_total_relation_size(relid) AS size_bytes
            FROM pg_catalog.pg_statio_user_tables
            ORDER BY pg_total_relation_size(relid) DESC
        """)).mappings().all()

    report = [dict(r) for r in rows]
    for r in report:
        log.info("storage.table",
                 table=r['table_name'],
                 size=r['total_size'])

    return report
