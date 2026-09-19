/**
 * FloodWatch Inference Module
 * Connects to FastAPI Backend powered by NASA-IBM Prithvi 2.0.
 * Orchestrates flood detection pipeline, updates multi-class analysis stats HUD,
 * and renders classified GeoJSON polygons on the interactive map.
 */

const BACKEND_BASE_URL = 'http://localhost:8000';

function getPopulationDensity() {
  const slider = document.getElementById('densitySlider');
  return slider ? Number(slider.value) : AppState.populationDensity;
}

function estimateFallbackImpact(area, density) {
  const exposed = Math.round(area * density * 0.85);
  const short = exposed >= 100000 ? `${(exposed / 100000).toFixed(1)}L` : exposed >= 1000 ? `${(exposed / 1000).toFixed(1)}K` : String(exposed);
  return {
    population_exposed: short,
    population_exposed_full: exposed.toLocaleString('en-IN'),
    evacuation_priority: `${Math.round(exposed * 0.38).toLocaleString('en-IN')} people`,
    settlements_impacted: `~${Math.max(1, Math.floor(area / 4.2))} habitations`,
    density_applied: `${density.toLocaleString('en-IN')} / km²`
  };
}

/**
 * Appends a timestamped log line to the Run Log panel.
 * @param {string} text - Log message
 */
function logLine(text) {
  const log = document.getElementById('runLog');
  if (!log) return;

  const time = new Date().toLocaleTimeString('en-IN', { hour12: false });
  const entry = document.createElement('div');
  entry.className = 'entry';
  entry.innerHTML = `<span class="t">${time}</span><span>${text}</span>`;
  log.prepend(entry);
}

/**
 * Updates topbar model status indicator.
 * @param {boolean} busy - Whether model is actively running
 * @param {string} text - Status label text
 */
function setStatus(busy, text) {
  const dot = document.getElementById('statusDot');
  const label = document.getElementById('statusText');
  if (dot) dot.classList.toggle('busy', busy);
  if (label) label.textContent = text;
}

/**
 * Resets analysis stats panel to empty initial state.
 */
function resetAnalysisView() {
  const resultsBlock = document.getElementById('resultsBlock');
  const emptyState = document.getElementById('emptyState');
  if (resultsBlock) resultsBlock.style.display = 'none';
  if (emptyState) emptyState.style.display = 'block';
}

/**
 * Calls FastAPI Backend /api/predict endpoint powered by Prithvi 2.0
 * @param {string} regionKey - 'assam' | 'bihar' | 'kerala'
 */
async function runInference(regionKey) {
  const dateInput = document.getElementById('dateInput');
  const payload = {
    region: regionKey,
    date: dateInput ? dateInput.value : new Date().toISOString().slice(0, 10),
    source: AppState.currentSource || 'sar',
    mode: AppState.currentMode || 'single',
    density: getPopulationDensity()
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);

    const res = await fetch(`${BACKEND_BASE_URL}/api/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      return {
        isLiveBackend: true,
        modelName: data.model || 'Prithvi-EO-2.0',
        stats: {
          area: data.stats.area_km2,
          permanent_water: data.stats.permanent_water_km2 || 380,
          total_water: data.stats.total_water_km2 || data.stats.area_km2,
          pop: data.stats.population_exposed,
          severity: data.stats.severity,
          confidence: data.stats.confidence,
          population_exposed_full: data.stats.population_exposed_full,
          evacuation_priority: data.stats.evacuation_priority,
          settlements_impacted: data.stats.settlements_impacted,
          density_applied: data.stats.density_applied
        },
        center: data.center || REGIONS[regionKey].center,
        bbox: data.bbox,
        geojson: data.geojson,
        inferenceTimeMs: data.inference_time_ms,
        // Sentinel-2 scene provenance (null when synthetic fallback was used)
        sceneDate: data.scene_date || null,
        sceneCloudCover: data.scene_cloud_cover !== undefined ? data.scene_cloud_cover : null,
        inferenceMethod: data.inference_method || 'Unknown method'
      };
    }
  } catch (err) {
    // Backend offline or timeout -> Proceed with client simulation
  }

  // Graceful Offline Simulation Fallback
  await new Promise((resolve) => setTimeout(resolve, 1800));
  const rStats = REGIONS[regionKey].stats;
  const fallbackImpact = estimateFallbackImpact(rStats.area, getPopulationDensity());
  return {
    isLiveBackend: false,
    modelName: 'Prithvi-EO-2.0 (Client Sim)',
    stats: {
      area: rStats.area,
      permanent_water: rStats.permanent_water || 350,
      total_water: rStats.total_water || rStats.area + 350,
      pop: fallbackImpact.population_exposed,
      severity: rStats.severity,
      confidence: rStats.confidence,
      ...fallbackImpact
    },
    center: REGIONS[regionKey].center,
    bbox: null,
    geojson: null,
    inferenceTimeMs: 1800,
    inferenceMethod: 'Offline demonstration fallback'
  };
}

/**
 * Calls FastAPI /api/predict/upload for custom satellite scenes.
 * @param {File} file - Uploaded image file
 */
async function runUploadInference(file) {
  const customLatInput = document.getElementById('customLat');
  const customLonInput = document.getElementById('customLon');
  const lat = customLatInput ? parseFloat(customLatInput.value) : AppState.customLat;
  const lon = customLonInput ? parseFloat(customLonInput.value) : AppState.customLon;

  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('lat', lat);
    formData.append('lon', lon);
    formData.append('source', AppState.currentSource || 'sar');
    formData.append('mode', AppState.currentMode || 'single');
    formData.append('density', getPopulationDensity());

    const controller = new AbortController();
    // GeoTIFF decoding and polygonisation can take longer than an ordinary
    // image upload, particularly on the first request to the local server.
    const timeoutId = setTimeout(() => controller.abort(), 90000);

    const res = await fetch(`${BACKEND_BASE_URL}/api/predict/upload`, {
      method: 'POST',
      body: formData,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();

      // Log coordinate extraction method immediately
      const locSrc = data.location_source || 'Unknown';
      const isGeoTiff  = locSrc.toLowerCase().includes('geotiff');
      const isExif     = locSrc.toLowerCase().includes('exif');
      const isManual   = locSrc.toLowerCase().includes('user');
      const iconColor  = isGeoTiff ? '#3ED6E8' : isExif ? '#a3e635' : isManual ? '#facc15' : 'var(--text-faint)';
      const icon       = isGeoTiff ? '&#128207;' : isExif ? '&#128247;' : isManual ? '&#128205;' : '&#9888;';
      logLine(
        `<span style="color:${iconColor};">${icon} Coordinates extracted</span> via ` +
        `<strong>${locSrc}</strong>`
      );

      if (data.center) {
        const [clat, clon] = data.center;
        logLine(
          `<span style="font-family:var(--mono);font-size:11px;color:#fff;">` +
          `${clat.toFixed(5)}&deg; N &nbsp; ${clon.toFixed(5)}&deg; E</span>`
        );
      }

      return {
        isLiveBackend: true,
        modelName: data.model || 'Prithvi-EO-2.0',
        locationSource: locSrc,
        center: data.center || [lat, lon],
        bbox: data.bbox,
        stats: {
          area: data.stats.area_km2,
          permanent_water: data.stats.permanent_water_km2 || 14.2,
          total_water: data.stats.total_water_km2 || data.stats.area_km2 + 14.2,
          pop: data.stats.population_exposed,
          severity: data.stats.severity,
          confidence: data.stats.confidence,
          population_exposed_full: data.stats.population_exposed_full,
          evacuation_priority: data.stats.evacuation_priority,
          settlements_impacted: data.stats.settlements_impacted,
          density_applied: data.stats.density_applied
        },
        geojson: data.geojson,
        inferenceTimeMs: data.inference_time_ms,
        inferenceMethod: data.inference_method || 'Unknown method'
      };
    }
  } catch (err) {
    // Backend offline fallback
  }

  await new Promise((resolve) => setTimeout(resolve, 1800));
  const fallbackImpact = estimateFallbackImpact(28.4, getPopulationDensity());
  return {
    isLiveBackend: false,
    modelName: 'Prithvi-EO-2.0 (Client Sim)',
    locationSource: 'Client Coordinate Estimator',
    center: [lat, lon],
    bbox: computeBbox(lat, lon, 25.0),
    stats: {
      area: 28.4,
      permanent_water: 8.6,
      total_water: 37.0,
      pop: fallbackImpact.population_exposed,
      severity: "moderate",
      confidence: 86,
      ...fallbackImpact
    },
    geojson: null,
    inferenceTimeMs: 1800,
    inferenceMethod: 'Offline demonstration fallback'
  };
}

/**
 * Executes the flood detection & classification pipeline for preset region or uploaded scene.
 * After inference, automatically flies the map to the detected coordinates and
 * renders the Prithvi 2.0 GeoJSON flood mask at the real geographic location.
 */
async function handleRun() {
  const btn = document.getElementById('runBtn');
  const scan = document.getElementById('scanOverlay');
  const emptyState = document.getElementById('emptyState');
  const resultsBlock = document.getElementById('resultsBlock');

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Running Prithvi 2.0…';
  }
  if (scan) scan.classList.add('active');

  setStatus(true, 'Classifying surface water (Prithvi 2.0)');

  const isUpload = AppState.usingCustomImage && AppState.uploadedFile;
  const targetLabel = isUpload
    ? `uploaded scene <strong>${AppState.uploadedFile.name}</strong>`
    : `<strong>${REGIONS[AppState.currentRegion].name}</strong>`;

  logLine(`Requested classification &amp; flood inference for ${targetLabel}`);

  let result;
  if (isUpload) {
    logLine(`<span style="color:var(--accent);">&#128207; Extracting geolocation from satellite scene…</span>`);
    result = await runUploadInference(AppState.uploadedFile);
  } else {
    result = await runInference(AppState.currentRegion);
  }

  if (scan) scan.classList.remove('active');

  const stats = result.stats;

  // ── 1. Render multi-class GeoJSON flood mask on the map ─────────────────────
  // For uploaded scenes, pass null as regionKey so drawFloodMask uses the
  // geojson bbox to position the view; for preset regions use the region key.
  if (isUpload) {
    drawFloodMaskAtLocation(result.geojson, result.center, result.bbox);
  } else {
    drawFloodMask(AppState.currentRegion, result.geojson);
    // Fly to the result center if backend returned a refined center point
    if (result.center && mapInstance) {
      mapInstance.flyTo(result.center, mapInstance.getZoom(), { animate: true, duration: 1.2 });
    }
  }

  if (emptyState) emptyState.style.display = 'none';
  if (resultsBlock) resultsBlock.style.display = 'block';

  // ── 2. Update classification stats cards ────────────────────────────────────
  const statArea = document.getElementById('statArea');
  const statPerm = document.getElementById('statPermanentWater');
  const statTotal = document.getElementById('statTotalWater');
  const statPop = document.getElementById('statPop');
  const statConf = document.getElementById('statConf');
  const confFill = document.getElementById('confFill');
  const sevEl = document.getElementById('statSeverity');
  const statCoords = document.getElementById('statCoords');
  const statPopFull = document.getElementById('statPopFull');
  const statEvacuation = document.getElementById('statEvacuation');
  const statSettlements = document.getElementById('statSettlements');
  const statPopDensityTag = document.getElementById('statPopDensityTag');

  if (statArea) statArea.innerHTML = `${stats.area.toLocaleString('en-IN')} <span class="unit">km²</span>`;
  if (statPerm) statPerm.innerHTML = `${stats.permanent_water.toLocaleString('en-IN')} <span class="unit">km²</span>`;
  if (statTotal) statTotal.innerHTML = `${stats.total_water.toLocaleString('en-IN')} <span class="unit">km²</span>`;
  if (statPop) statPop.textContent = stats.pop;
  if (statConf) statConf.textContent = `${stats.confidence}%`;
  if (confFill) confFill.style.width = `${stats.confidence}%`;
  if (sevEl) sevEl.innerHTML = `<span class="severity-badge ${stats.severity}">${stats.severity}</span>`;
  if (statPopFull) statPopFull.textContent = stats.population_exposed_full || '';
  if (statEvacuation) statEvacuation.textContent = stats.evacuation_priority || '—';
  if (statSettlements) statSettlements.textContent = stats.settlements_impacted || '—';
  if (statPopDensityTag) statPopDensityTag.textContent = stats.density_applied || `${getPopulationDensity().toLocaleString('en-IN')} / km²`;

  if (statCoords && result.center) {
    statCoords.textContent = `${result.center[0].toFixed(4)}° N, ${result.center[1].toFixed(4)}° E`;
  }

  // ── 3. Run log output ───────────────────────────────────────────────────────
  const backendTag = result.isLiveBackend
    ? `<span style="color:var(--safe);">[FastAPI • ${result.modelName}]</span>`
    : `<span style="color:var(--warn);">[Offline Sim]</span>`;

  logLine(`Classification complete ${backendTag} — Flood: ${stats.area} km², Permanent: ${stats.permanent_water} km²`);
  if (result.inferenceMethod) {
    logLine(`<span style="color:var(--text-faint);">Method: ${result.inferenceMethod}</span>`);
  }

  // Log the resolved geographic coordinates
  if (result.center) {
    const [lat, lon] = result.center;
    const locSrc = result.locationSource || (isUpload ? 'Extracted from scene' : 'Preset region');
    logLine(
      `<span style="color:var(--accent);">&#127759; Location resolved</span> — ` +
      `<span style="font-family:var(--mono);font-size:11px;">` +
      `${lat.toFixed(5)}° N, ${lon.toFixed(5)}° E` +
      `</span> &nbsp;<span style="color:var(--text-faint);font-size:10.5px;">(${locSrc})</span>`
    );
  }

  // Log Sentinel-2 scene provenance when live optical data was used
  if (result.isLiveBackend) {
    if (result.sceneDate) {
      const sceneISO = new Date(result.sceneDate).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
      const cloudStr = result.sceneCloudCover !== null ? ` &nbsp;&#9729; ${result.sceneCloudCover.toFixed(1)}% cloud` : '';
      logLine(`<span style="color:var(--accent);">Sentinel-2 scene:</span> <span style="font-family:var(--mono);font-size:11px;">${sceneISO}${cloudStr}</span>`);
    } else {
      logLine(`<span style="color:var(--text-faint);">&#9881; Synthetic SAR simulation used (optical scene unavailable)</span>`);
    }
  }

  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Run Prithvi 2.0 Detection';
  }
  setStatus(false, 'Model idle');
}

/**
 * Renders GeoJSON flood mask for an uploaded scene at its real geographic
 * location, then flies the Leaflet map to those coordinates.
 * @param {Object|null} geojsonData - Multi-class GeoJSON from Prithvi 2.0 backend
 * @param {Array<number>|null} center - [lat, lon] scene center
 * @param {Array<number>|null} bbox   - [min_lat, min_lon, max_lat, max_lon]
 */
function drawFloodMaskAtLocation(geojsonData, center, bbox) {
  // Remove any previous vector layer
  if (floodVectorLayer) {
    mapInstance.removeLayer(floodVectorLayer);
    floodVectorLayer = null;
  }

  if (geojsonData && geojsonData.type === 'FeatureCollection' && geojsonData.features.length > 0) {
    // Render real Prithvi 2.0 multi-class GeoJSON polygons
    floodVectorLayer = L.geoJSON(geojsonData, {
      pane: 'floodPane',
      style: (feature) => {
        const props = feature.properties || {};
        const isFlood = props.category === 'flood_water' || props.class_id === 1;
        return {
          color: props.color || (isFlood ? '#3ED6E8' : '#5C9CC7'),
          weight: 3,
          opacity: 1,
          fillColor: props.color || (isFlood ? '#3ED6E8' : '#5C9CC7'),
          fillOpacity: Math.max(0.45, AppState.maskOpacity * (isFlood ? 0.6 : 0.85))
        };
      },
      onEachFeature: (feature, layer) => {
        if (feature.properties) {
          const props = feature.properties;
          layer.bindPopup(`
            <div style="font-family:var(--sans);font-size:12px;color:#111;padding:4px;">
              <strong style="color:${props.color || '#0088cc'};font-size:13px;">${props.water_type || 'Classified Water Body'}</strong><br/>
              Classification: <strong>${props.category === 'flood_water' ? 'Recent Inundation' : 'River / Basin'}</strong><br/>
              Surface Area: <strong>${props.area_km2 || '—'} km²</strong><br/>
              Model: <span style="font-size:10.5px;color:#555;">${props.sensor || 'Prithvi-EO-2.0'}</span>
            </div>
          `);
        }
      }
    }).addTo(mapInstance);

    floodVectorLayer.bringToFront();

    // Fly to the GeoJSON bounds
    try {
      const bounds = floodVectorLayer.getBounds();
      if (bounds.isValid()) {
        mapInstance.invalidateSize();
        mapInstance.flyToBounds(bounds, { padding: [35, 35], maxZoom: 13, animate: true, duration: 1.4 });
        return;
      }
    } catch (_) {}
  }

  // Fallback: use bbox or center to position the map even without GeoJSON polygons
  if (bbox) {
    const latLngBounds = L.latLngBounds([bbox[0], bbox[1]], [bbox[2], bbox[3]]);
    mapInstance.flyToBounds(latLngBounds, { padding: [35, 35], maxZoom: 13, animate: true, duration: 1.4 });
  } else if (center) {
    mapInstance.flyTo(center, 11, { animate: true, duration: 1.4 });
  }
}
