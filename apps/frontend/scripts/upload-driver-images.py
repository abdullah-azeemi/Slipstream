"""Upload the private driver cutouts in public/drivers to R2.

Run from the repo root (uses the R2_* settings from .env):

    uv run python apps/frontend/scripts/upload-driver-images.py

Files go to <TELEMETRY_ARTIFACT_BUCKET>/drivers/<code>.png. The API serves them
at /api/v1/drivers/<code>/image and the frontend rewrites /drivers/<code>.png
there, so the bucket itself stays private.
"""

import pathlib

import boto3

from backend.config import settings

folder = pathlib.Path(__file__).resolve().parents[1] / "public" / "drivers"
client = boto3.client(
    "s3",
    endpoint_url=settings.r2_endpoint_url,
    aws_access_key_id=settings.r2_access_key_id,
    aws_secret_access_key=settings.r2_secret_access_key,
    region_name="auto",
)
count = 0
for path in sorted(folder.glob("*.png")):
    client.put_object(
        Bucket=settings.telemetry_artifact_bucket,
        Key=f"drivers/{path.stem.lower()}.png",
        Body=path.read_bytes(),
        ContentType="image/png",
        CacheControl="public, max-age=86400",
    )
    count += 1
print(f"uploaded {count} image(s) to {settings.telemetry_artifact_bucket}/drivers/")
