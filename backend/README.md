# FloodWatch AI Backend — Prithvi 2.0 Engine

FastAPI backend powered by the **NASA-IBM Prithvi 2.0** Earth Observation foundation model (`ibm-nasa-geospatial/Prithvi-EO-2.0-300M`), generating real vector GeoJSON polygon masks with high-precision latitude/longitude coordinates.

> Important: the bundled Prithvi file is a **pretrained foundation checkpoint**, not a flood-segmentation checkpoint. The backend therefore uses a live Sentinel-2 NDWI/MNDWI classifier for optical requests and labels other fallback modes explicitly. Configure a compatible, flood-finetuned model before claiming Prithvi segmentation results.

---

## 🛠️ Setup & Installation

### 1. Create Virtual Environment
```bash
# From project root
python -m venv .venv

# Activate on Windows PowerShell:
.venv\Scripts\Activate.ps1

# Activate on Linux/macOS:
source .venv/bin/activate
```

### 2. Install Dependencies
```bash
pip install -r backend/requirements.txt
```

### 3. Download NASA-IBM Prithvi 2.0 Foundation Model
```bash
python backend/download_model.py
```
This fetches the Prithvi 2.0 Vision Transformer (ViT) checkpoint and config files into `backend/models/prithvi_2_0/`.

---

## 🚀 Running the FastAPI Server

```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

- **Interactive API Docs (Swagger UI):** [http://localhost:8000/docs](http://localhost:8000/docs)
- **Health Endpoint:** [http://localhost:8000/health](http://localhost:8000/health)

---

## 📡 API Endpoints

### 1. `GET /api/regions`
Returns all preset monitoring sites (Assam, Bihar, Kerala) with exact geographic bounding boxes $[min\_lat, min\_lon, max\_lat, max\_lon]$.

### 2. `POST /api/predict`
Runs Prithvi 2.0 flood segmentation inference on a preset region.

**Request Payload:**
```json
{
  "region": "assam",
  "date": "2026-08-14",
  "source": "sar",
  "mode": "single"
}
```

**Response Payload:**
```json
{
  "success": true,
  "region": "Assam — Brahmaputra Basin",
  "date": "2026-08-14",
  "source": "sar",
  "mode": "single",
  "model": "Prithvi-EO-2.0-300M",
  "device": "cuda",
  "stats": {
    "area_km2": 1842.5,
    "population_exposed": "6.1L",
    "severity": "severe",
    "confidence": 91.4
  },
  "geojson": {
    "type": "FeatureCollection",
    "bbox": [25.8, 92.3, 26.65, 93.3],
    "features": [
      {
        "type": "Feature",
        "id": "assam_flood_poly_1",
        "properties": {
          "id": "flood_polygon_1",
          "water_type": "surface_flood_water",
          "sensor": "Sentinel-1 SAR / Prithvi-EO-2.0",
          "area_km2": 1842.5,
          "confidence_score": 91.4
        },
        "geometry": {
          "type": "Polygon",
          "coordinates": [
            [ [92.55, 26.35], [92.85, 26.42], [93.15, 26.30], [93.05, 26.05], [92.55, 26.35] ]
          ]
        }
      }
    ]
  },
  "timestamp": "2026-08-20T02:37:00.000000",
  "inference_time_ms": 42.8
}
```

### 3. `POST /api/predict/upload`
Accepts multipart file upload (`.tif`, `.png`, `.jpg`), runs segmentation inference on custom AOI scene, and returns GeoJSON features and calculated statistics.
