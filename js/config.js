/**
 * FloodWatch Configuration & Region Presets
 * Contains coordinates, polygon outlines, and baseline statistics for preset monitoring sites.
 */

const REGIONS = {
  assam: {
    name: "Assam — Brahmaputra Basin",
    center: [26.2006, 92.9376],
    zoom: 8,
    polygon: [
      [26.35, 92.55], [26.42, 92.85], [26.30, 93.15], [26.05, 93.05],
      [25.95, 92.75], [26.05, 92.50], [26.35, 92.55]
    ],
    stats: {
      area: 1842,
      permanent_water: 420,
      total_water: 2262,
      pop: "6.1L",
      severity: "severe",
      confidence: 91
    },
    populationDensity: 398
  },
  bihar: {
    name: "Bihar — Kosi River",
    center: [25.9333, 86.8667],
    zoom: 8,
    polygon: [
      [26.05, 86.55], [26.15, 86.85], [26.00, 87.05], [25.78, 86.95],
      [25.72, 86.70], [25.85, 86.50], [26.05, 86.55]
    ],
    stats: {
      area: 963,
      permanent_water: 310,
      total_water: 1273,
      pop: "2.4L",
      severity: "moderate",
      confidence: 87
    },
    populationDensity: 1106
  },
  kerala: {
    name: "Kerala — Periyar Basin",
    center: [10.1632, 76.6413],
    zoom: 9,
    polygon: [
      [10.25, 76.50], [10.30, 76.68], [10.18, 76.80], [10.05, 76.72],
      [10.02, 76.55], [10.12, 76.45], [10.25, 76.50]
    ],
    stats: {
      area: 418,
      permanent_water: 185,
      total_water: 603,
      pop: "89K",
      severity: "low",
      confidence: 83
    },
    populationDensity: 860
  }
};

// Global App State
const AppState = {
  currentRegion: "assam",
  currentSource: "sar",
  currentMode: "single",
  maskOpacity: 0.65,
  usingCustomImage: false,
  uploadedFile: null,
  uploadedImageUrl: null,
  uploadedBbox: null, // [min_lat, min_lon, max_lat, max_lon]
  customLat: 26.2006,
  customLon: 92.9376,
    compareMode: false,
    comparePercent: 50,
    maskBlobs: null,
    populationDensity: 398
};
