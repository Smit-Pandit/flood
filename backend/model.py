from __future__ import annotations

"""FloodWatch classification and explicitly labelled demonstration fallbacks."""

import math
import logging
from typing import Any, Dict, Optional, Tuple

import numpy as np

try:
    import torch
except ImportError:
    torch = None

from .config import DEVICE, MODEL_CHECKPOINT_FILE, MODEL_DIR

logger = logging.getLogger("floodwatch.prithvi")
_S2_SCALE = 10_000.0
_PRITHVI_BAND_ORDER = ["BLUE", "GREEN", "RED", "NIR_NARROW", "SWIR_1", "SWIR_2"]


class Prithvi2FloodDetector:
    """Reports Prithvi availability and runs non-model fallback methods safely."""

    def __init__(self, device: str = DEVICE):
        self.device = device
        self.model = None
        self.is_loaded = False
        self.weights_loaded = False
        self.last_inference_method = "Not run"
        checkpoint = MODEL_DIR / MODEL_CHECKPOINT_FILE
        self.model_status = (
            "Prithvi foundation checkpoint found, but no compatible "
            "flood-segmentation head/checkpoint is configured"
            if checkpoint.exists() else "Prithvi checkpoint is not installed"
        )
        logger.warning(self.model_status)

    def preprocess_sentinel_bands(self, bands_dict: Dict[str, np.ndarray]) -> Optional[Any]:
        if torch is None:
            return None
        stacked = np.stack(
            [np.clip(bands_dict[name] / _S2_SCALE, 0.0, 1.0) for name in _PRITHVI_BAND_ORDER], axis=0
        )
        return torch.from_numpy(stacked).unsqueeze(0).float().to(self.device)

    def _ndwi_heuristic(self, bands: Dict[str, np.ndarray]) -> Tuple[np.ndarray, np.ndarray]:
        green = bands["GREEN"].astype(np.float32) / _S2_SCALE
        nir = bands["NIR_NARROW"].astype(np.float32) / _S2_SCALE
        swir1 = bands["SWIR_1"].astype(np.float32) / _S2_SCALE
        ndwi = np.where(green + nir > 0, (green - nir) / (green + nir + 1e-8), 0.0)
        mndwi = np.where(green + swir1 > 0, (green - swir1) / (green + swir1 + 1e-8), 0.0)
        mask = np.zeros(green.shape, dtype=np.uint8)
        mask[(ndwi > 0.05) | (mndwi > 0.0)] = 1
        mask[(ndwi > 0.25) & (mndwi > 0.15)] = 2
        confidence = np.clip(np.abs(ndwi) * 100, 60, 97).astype(np.float32)
        return mask, confidence

    def predict_uploaded_geotiff(self, file_bytes: bytes, filename: str) -> Tuple[np.ndarray, np.ndarray]:
        """Read scientific TIFF bands with rasterio rather than Pillow RGB conversion."""
        try:
            from rasterio.io import MemoryFile
            with MemoryFile(file_bytes) as memory_file:
                with memory_file.open() as dataset:
                    data = dataset.read(masked=True).astype(np.float32).filled(np.nan)
        except Exception as exc:
            raise ValueError(f"Unsupported GeoTIFF raster: {exc}") from exc
        if data.ndim != 3 or data.shape[0] == 0:
            raise ValueError("GeoTIFF contains no raster bands")

        count, height, width = data.shape
        confidence = np.full((height, width), 88.0, dtype=np.float32)
        name = filename.lower()
        raw, valid = data[0], np.isfinite(data[0])

        # Sen1Floods11 labels are reference data, never model predictions.
        if "jrcwater" in name:
            mask = np.zeros((height, width), dtype=np.uint8)
            mask[valid & (raw > 0)] = 2
            self.last_inference_method = "Uploaded JRC permanent-water reference mask (not model inference)"
            return mask, confidence
        if "labelhand" in name or "s1otsulabel" in name:
            mask = np.zeros((height, width), dtype=np.uint8)
            mask[valid & (raw == 1)] = 1
            self.last_inference_method = "Uploaded Sen1Floods11 reference flood label (not model inference)"
            return mask, confidence

        # Sen1Floods11 S2 band order: B1..B12, with B8 at index 7 and B11 at 11.
        if count >= 12:
            self.last_inference_method = "Uploaded Sentinel-2 NDWI/MNDWI water-index heuristic"
            return self._ndwi_heuristic({"GREEN": data[2], "NIR_NARROW": data[7], "SWIR_1": data[11]})

        # Low backscatter is only a visual water candidate, not flood confirmation.
        if count >= 2:
            mask = np.zeros((height, width), dtype=np.uint8)
            if valid.any():
                mask[valid & (raw <= np.nanpercentile(raw[valid], 12))] = 1
            self.last_inference_method = "Uploaded Sentinel-1 low-backscatter water-candidate heuristic"
            return mask, confidence

        finite = np.isfinite(data)
        if not finite.any():
            return np.zeros((height, width), dtype=np.uint8), confidence
        low, high = np.nanpercentile(data[finite], [1, 99])
        scaled = np.zeros_like(data) if high <= low else np.clip((data - low) / (high - low), 0, 1)
        gray = scaled[0]
        mask = np.zeros((height, width), dtype=np.uint8)
        mask[gray < .32] = 2
        mask[(gray >= .32) & (gray < .52)] = 1
        self.last_inference_method = "Uploaded GeoTIFF luminance water heuristic"
        return mask, confidence

    def predict(self, region_id: str, source: str = "sar", mode: str = "single", input_image: Optional[np.ndarray] = None, bands_tensor: Optional[Any] = None, bands_dict: Optional[Dict[str, np.ndarray]] = None) -> Tuple[np.ndarray, np.ndarray]:
        if bands_dict is not None:
            self.last_inference_method = "Live Sentinel-2 NDWI/MNDWI water-index classifier"
            return self._ndwi_heuristic(bands_dict)
        height, width = input_image.shape[:2] if input_image is not None else (256, 256)
        mask = np.zeros((height, width), dtype=np.uint8)
        confidence = np.full((height, width), 88.0, dtype=np.float32)
        y, x = np.ogrid[:height, :width]
        if region_id == "assam":
            channel = np.abs(y / height - .48 - np.sin(x / width * 4 * math.pi) * .15) < .05
            flood = (np.abs(y / height - .48 - np.sin(x / width * 4 * math.pi) * .25) < .22) & ~channel
            mask[flood], mask[channel] = 1, 2
            self.last_inference_method = "Demonstration spatial fallback (no SAR scene supplied)"
        elif region_id == "bihar":
            channel = np.abs(x / width - .52 - np.cos(y / height * 3 * math.pi) * .12) < .06
            flood = (np.abs(x / width - .52 - np.cos(y / height * 3 * math.pi) * .22) < .26) & ~channel
            mask[flood], mask[channel] = 1, 2
            self.last_inference_method = "Demonstration spatial fallback (no SAR scene supplied)"
        elif region_id == "kerala":
            dist = np.sqrt((x / width - .5) ** 2 + (y / height - .5) ** 2)
            mask[(dist < .32) & (dist >= .12)], mask[dist < .12] = 1, 2
            self.last_inference_method = "Demonstration spatial fallback (no SAR scene supplied)"
        elif input_image is not None:
            gray = np.mean(input_image, axis=2) / 255.0
            mask[gray < .32] = 2
            mask[(gray >= .32) & (gray < .52)] = 1
            self.last_inference_method = "Uploaded RGB luminance water heuristic"
        else:
            self.last_inference_method = "Demonstration spatial fallback"
        return mask, confidence


detector = Prithvi2FloodDetector()
