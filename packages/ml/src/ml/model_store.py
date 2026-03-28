from __future__ import annotations

import re
from pathlib import Path

MODEL_DIR = Path("./ml_models")
GLOBAL_MODEL_PATH = MODEL_DIR / "race_predictor.pkl"
GP_MODEL_DIR = MODEL_DIR / "gp"

MODEL_DIR.mkdir(exist_ok=True)
GP_MODEL_DIR.mkdir(parents=True, exist_ok=True)


def slugify_gp_name(gp_name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", gp_name.lower()).strip("-")
    return slug or "unknown-gp"


def gp_model_path(gp_name: str) -> Path:
    return GP_MODEL_DIR / f"{slugify_gp_name(gp_name)}.pkl"
