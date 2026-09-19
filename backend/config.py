"""
FloodWatch Backend Configuration
Configures server parameters, HuggingFace model repository, device selection,
and preset geographic bounding boxes (lat/lon envelopes).
"""

import os
from pathlib import Path

# Paths
BASE_DIR = Path(__file__).resolve().parent
MODEL_DIR = BASE_DIR / "models" / "prithvi_2_0"
MODEL_DIR.mkdir(parents=True, exist_ok=True)

# HuggingFace Model Configuration for NASA-IBM Prithvi 2.0
HF_REPO_ID = os.getenv("PRITHVI_HF_REPO", "ibm-nasa-geospatial/Prithvi-EO-2.0-300M")
MODEL_CHECKPOINT_FILE = os.getenv("PRITHVI_CHECKPOINT", "Prithvi_EO_V2_300M.pt")
MODEL_CONFIG_FILE = os.getenv("PRITHVI_CONFIG", "config.json")

# Device configuration. The live optical classifier does not require PyTorch;
# keep startup working until a compatible, flood-finetuned model is installed.
try:
    import torch
    DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
except ImportError:
    DEVICE = "cpu"

# Geographic Envelopes & Metadata for Preset Sites (min_lat, min_lon, max_lat, max_lon)
MONITORING_REGIONS = {
    "assam": {
        "id": "assam",
        "name": "Assam — Brahmaputra Basin",
        "state": "Assam",
        "country": "India",
        "bbox": [25.80, 92.30, 26.65, 93.30],  # [min_lat, min_lon, max_lat, max_lon]
        "center": [26.2006, 92.9376],
        "zoom": 8,
        "population_density_sqkm": 398,
        "default_risk_level": "High"
    },
    "bihar": {
        "id": "bihar",
        "name": "Bihar — Kosi River",
        "state": "Bihar",
        "country": "India",
        "bbox": [25.50, 86.30, 26.35, 87.25],
        "center": [25.9333, 86.8667],
        "zoom": 8,
        "population_density_sqkm": 1106,
        "default_risk_level": "Critical"
    },
    "kerala": {
        "id": "kerala",
        "name": "Kerala — Periyar Basin",
        "state": "Kerala",
        "country": "India",
        "bbox": [9.85, 76.30, 10.45, 77.00],
        "center": [10.1632, 76.6413],
        "zoom": 9,
        "population_density_sqkm": 860,
        "default_risk_level": "Moderate"
    }
}
