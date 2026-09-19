# FloodWatch — AI Satellite Flood Extent Monitor

A high-performance interactive monitoring dashboard for satellite-based flood extent detection and surface water analysis (Sentinel-1 SAR / Sentinel-2 Optical).

---

## 📁 Project Structure

The project has been organized into modular folders separating presentation structure, styling, interactive logic, assets, and documentation:

```
AI-disaster_detector/
├── index.html                      # Standard web entry point
├── floodwatch_dashboard.html       # Direct dashboard HTML entry point
│
├── css/                            # Modular CSS stylesheets
│   ├── main.css                    # Design tokens (:root), typography, contour background, scrollbars
│   ├── layout.css                  # Sticky topbar, responsive 3-column layout grid, panel containers
│   ├── components.css              # Form controls, toggle groups, sliders, upload zone, badges, stats cards, log
│   └── map.css                     # Leaflet map container, custom image stage, compare slider, radar scan effect
│
├── js/                             # Modular JavaScript architecture
│   ├── config.js                   # Preset monitoring regions (Assam, Bihar, Kerala), coordinates, baseline stats
│   ├── map.js                      # Leaflet map initialization, Esri basemaps, coordinate tracker, polygon rendering
│   ├── compare.js                  # Before / After split-screen slider with touch/mouse drag handlers & clip-path
│   ├── upload.js                   # Custom satellite scene upload, preview reader, canvas mask segmentation blobs
│   ├── inference.js                # Inference pipeline, radar scan animation, run log, HUD metrics, backend API stub
│   └── app.js                      # Main application entry point & DOM event listener bindings
│
├── assets/                         # Static assets directory
│   └── README.md                   # Guide for icons, sample GeoTIFFs, and overlays
│
└── README.md                       # Project documentation and architecture guide
```

---

## 🚀 Getting Started

### 1. Running Locally
You can open `index.html` or `floodwatch_dashboard.html` directly in any modern web browser, or serve it using any static HTTP server:

#### Using Python:
```bash
# Python 3
python -m http.server 8080
```
Then navigate to `http://localhost:8080` in your browser.

#### Using Node / npx:
```bash
npx serve .
```

---

## 🛰️ Features

1. **Interactive Satellite Basemap**:
   - High-resolution Esri World Imagery with overlaid administrative boundaries and place labels.
   - Live latitude & longitude coordinate tracking HUD on hover.

2. **Preset Monitoring Sites**:
   - **Assam** — Brahmaputra Basin
   - **Bihar** — Kosi River
   - **Kerala** — Periyar Basin

3. **Inference & Water Segmentation**:
   - Trigger flood extent segmentation with animated radar sweep scan line.
   - Dynamic flood polygon overlay with adjustable mask opacity.
   - Metric cards: Flooded area ($km^2$), estimated population exposed, severity badge (Severe / Moderate / Low), model confidence gauge.
   - Timestamped run history log.

4. **Before / After Split-Screen Comparison**:
   - Drag-to-compare interactive slider overlaying detected flood extents against baseline dry-land satellite imagery.

5. **Custom Scene AOI Upload**:
   - Drag & drop custom satellite imagery (`.png`, `.jpg`, or `.tif`).
   - Dynamic canvas segmentation mask generation.

---

## 🔌 Connecting to a FastAPI / PyTorch Backend

To connect the frontend to a live deep learning backend (e.g., U-Net / SegFormer trained on Sentinel-1 SAR imagery), edit [`js/inference.js`](file:///d:/Projects/AI-disaster_detector/js/inference.js#L42):

```javascript
async function runInference(regionKey) {
  const response = await fetch('http://localhost:8000/predict', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      region: regionKey,
      date: document.getElementById('dateInput').value,
      source: AppState.currentSource, // 'sar' | 'optical'
      mode: AppState.currentMode      // 'single' | 'change'
    })
  });
  
  const data = await response.json();
  // Expected response format:
  // {
  //   "area": 1842,
  //   "pop": "6.1L",
  //   "severity": "severe",
  //   "confidence": 91,
  //   "polygon": [[26.35, 92.55], ...] // GeoJSON or polygon coordinates
  // }
  return data;
}
```
