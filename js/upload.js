/**
 * FloodWatch Custom Upload & Geolocation Module
 * Handles satellite image upload, EXIF/manual geolocation target bounds calculation,
 * and direct georeferenced rendering on the Leaflet map.
 *
 * Key behaviour:
 *   - When a JPEG scene with GPS EXIF tags is loaded, lat/lon are extracted
 *     automatically and the Leaflet map pre-positions the image overlay.
 *   - After Prithvi 2.0 inference, the map flies to the resolved coordinates
 *     and renders the classified flood polygons at those exact coordinates.
 */

/**
 * Calculates a bounding box [min_lat, min_lon, max_lat, max_lon] from center lat/lon and span in km.
 */
function computeBbox(centerLat, centerLon, spanKm = 25.0) {
  const latSpan = spanKm / 111.139;
  const lonSpan = spanKm / (111.139 * Math.cos(centerLat * (Math.PI / 180)));
  return [
    +(centerLat - latSpan / 2).toFixed(5),
    +(centerLon - lonSpan / 2).toFixed(5),
    +(centerLat + latSpan / 2).toFixed(5),
    +(centerLon + lonSpan / 2).toFixed(5)
  ];
}

/**
 * Extracts GPS latitude & longitude from a JPEG file's EXIF metadata
 * using a pure-JS ArrayBuffer / DataView parser (no external library).
 * @param {File} file - Image file to parse
 * @returns {Promise<{lat: number, lon: number}|null>}
 */
async function extractExifGpsFromFile(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const buf = e.target.result;
        const view = new DataView(buf);

        // Must start with JPEG SOI marker 0xFFD8
        if (view.getUint16(0) !== 0xFFD8) { resolve(null); return; }

        let offset = 2;
        while (offset < view.byteLength - 2) {
          const marker = view.getUint16(offset);
          offset += 2;
          const segLen = view.getUint16(offset); // segment length includes the 2 length bytes

          if (marker === 0xFFE1) {
            // APP1 — may contain EXIF
            const exifHeader = String.fromCharCode(
              view.getUint8(offset + 2), view.getUint8(offset + 3),
              view.getUint8(offset + 4), view.getUint8(offset + 5)
            );
            if (exifHeader === 'Exif') {
              const tiffStart = offset + 8; // skip 2-byte len + "Exif\0\0"
              const littleEndian = view.getUint16(tiffStart) === 0x4949;
              const getUint16 = (o) => view.getUint16(tiffStart + o, littleEndian);
              const getUint32 = (o) => view.getUint32(tiffStart + o, littleEndian);

              const ifd0Offset = getUint32(4);
              const ifd0Count = getUint16(ifd0Offset);

              let gpsIfdOffset = null;
              for (let i = 0; i < ifd0Count; i++) {
                const entryOffset = ifd0Offset + 2 + i * 12;
                const tag = getUint16(entryOffset);
                if (tag === 0x8825) { // GPSInfo IFD pointer
                  gpsIfdOffset = getUint32(entryOffset + 8);
                  break;
                }
              }

              if (gpsIfdOffset === null) { resolve(null); return; }

              const gpsCount = getUint16(gpsIfdOffset);
              const gps = {};
              for (let i = 0; i < gpsCount; i++) {
                const eOff = gpsIfdOffset + 2 + i * 12;
                const tag = getUint16(eOff);
                const type = getUint16(eOff + 2);
                const cnt  = getUint32(eOff + 4);
                const valOff = eOff + 8;

                if (type === 2) {
                  // ASCII string
                  const strOff = cnt > 4 ? getUint32(valOff) : valOff - tiffStart; // relative already
                  const chars = [];
                  for (let c = 0; c < cnt - 1; c++) {
                    chars.push(String.fromCharCode(view.getUint8(tiffStart + (cnt > 4 ? getUint32(valOff) : valOff - 0) + c)));
                  }
                  // Simple: read directly as ASCII at tiffStart+valueOffset
                  let asciiOff = cnt > 4 ? tiffStart + getUint32(valOff) : tiffStart + valOff - tiffStart;
                  // Simpler path — just store the DataView offset for ref:
                  gps[tag] = { type: 'ascii', offset: asciiOff, count: cnt };
                } else if (type === 5) {
                  // RATIONAL: array of (numerator, denominator) uint32 pairs
                  const ratOff = tiffStart + getUint32(valOff);
                  const rationals = [];
                  for (let r = 0; r < cnt; r++) {
                    const num = view.getUint32(ratOff + r * 8, littleEndian);
                    const den = view.getUint32(ratOff + r * 8 + 4, littleEndian);
                    rationals.push(den !== 0 ? num / den : 0);
                  }
                  gps[tag] = rationals;
                }
              }

              // Tag 1 = GPSLatitudeRef, Tag 2 = GPSLatitude (rational)
              // Tag 3 = GPSLongitudeRef, Tag 4 = GPSLongitude (rational)
              const latR = gps[2], lonR = gps[4];
              const latRef = gps[1], lonRef = gps[3];

              if (!latR || !lonR) { resolve(null); return; }

              const dmsToDecimal = ([d, m, s]) => d + m / 60 + s / 3600;
              let lat = dmsToDecimal(latR);
              let lon = dmsToDecimal(lonR);

              // Read ref chars from DataView if they were stored as ascii objects
              const readRefChar = (ref) => {
                if (!ref) return null;
                if (typeof ref === 'string') return ref[0];
                if (ref.type === 'ascii') return String.fromCharCode(view.getUint8(ref.offset));
                return null;
              };
              const latRefChar = readRefChar(latRef);
              const lonRefChar = readRefChar(lonRef);
              if (latRefChar === 'S') lat = -lat;
              if (lonRefChar === 'W') lon = -lon;

              resolve({ lat: +lat.toFixed(6), lon: +lon.toFixed(6) });
              return;
            }
          }
          offset += segLen;
          // Stop at SOS marker (actual image data starts)
          if (marker === 0xFFDA) break;
        }
        resolve(null);
      } catch (_) {
        resolve(null);
      }
    };
    reader.readAsArrayBuffer(file.slice(0, 65536)); // Read first 64 KB — enough for EXIF
  });
}

/**
 * Clears uploaded file, resets upload zone state, and removes map overlay.
 */
function clearUpload() {
  AppState.uploadedFile = null;
  AppState.uploadedImageUrl = null;
  AppState.uploadedBbox = null;
  AppState.usingCustomImage = false;

  const fileInput = document.getElementById('fileInput');
  if (fileInput) fileInput.value = '';

  const zone = document.getElementById('uploadZone');
  if (zone) zone.classList.remove('has-file');

  const content = document.getElementById('uploadZoneContent');
  if (content) {
    content.innerHTML = `
      Drop recent satellite scene / upload image<br />to classify water & calculate population impact
      <div style="margin-top:6px; color:var(--text-faint); font-size:10.5px;">GeoTIFF, PNG, JPG (Auto-Geolocated)</div>
    `;
  }

  clearUploadedImageFromMap();
  drawRegionOutline(AppState.currentRegion);
  resetAnalysisView();
}

/**
 * Updates the image overlay position on the map if coordinates are manually changed.
 */
function updateImageOverlayPosition() {
  if (!AppState.usingCustomImage || !AppState.uploadedImageUrl) return;

  const latInput = document.getElementById('customLat');
  const lonInput = document.getElementById('customLon');
  if (!latInput || !lonInput) return;

  const lat = parseFloat(latInput.value) || AppState.customLat;
  const lon = parseFloat(lonInput.value) || AppState.customLon;
  AppState.customLat = lat;
  AppState.customLon = lon;

  const bbox = computeBbox(lat, lon, 25.0);
  renderUploadedImageOnMap(AppState.uploadedImageUrl, bbox);
}

/**
 * Sets up upload zone click, drop, coordinate controls, and file change handlers.
 */
function setupUploadHandlers() {
  const uploadZone = document.getElementById('uploadZone');
  const fileInput = document.getElementById('fileInput');
  const useMapCenterBtn = document.getElementById('useMapCenterBtn');
  const customLatInput = document.getElementById('customLat');
  const customLonInput = document.getElementById('customLon');

  if (uploadZone && fileInput) {
    uploadZone.addEventListener('click', () => {
      fileInput.click();
    });

    uploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadZone.style.borderColor = 'var(--accent)';
    });

    uploadZone.addEventListener('dragleave', () => {
      uploadZone.style.borderColor = '';
    });

    uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadZone.style.borderColor = '';
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        fileInput.files = e.dataTransfer.files;
        handleFileSelect(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        handleFileSelect(file);
      }
    });
  }

  // "Use Map Center" button
  if (useMapCenterBtn && mapInstance) {
    useMapCenterBtn.addEventListener('click', () => {
      const center = mapInstance.getCenter();
      if (customLatInput) customLatInput.value = center.lat.toFixed(4);
      if (customLonInput) customLonInput.value = center.lng.toFixed(4);
      AppState.customLat = center.lat;
      AppState.customLon = center.lng;

      if (AppState.usingCustomImage) {
        updateImageOverlayPosition();
      }
    });
  }

  if (customLatInput) customLatInput.addEventListener('change', updateImageOverlayPosition);
  if (customLonInput) customLonInput.addEventListener('change', updateImageOverlayPosition);
}

/**
 * Handles processing and georeferencing of an uploaded satellite scene.
 * Automatically extracts EXIF GPS coordinates when present, pre-positions
 * the map overlay, and populates the lat/lon input fields.
 * @param {File} file - Selected satellite image file
 */
async function handleFileSelect(file) {
  AppState.uploadedFile = file;
  AppState.usingCustomImage = true;

  const zone = document.getElementById('uploadZone');
  const content = document.getElementById('uploadZoneContent');
  const customLatInput = document.getElementById('customLat');
  const customLonInput = document.getElementById('customLon');

  if (zone) zone.classList.add('has-file');

  // ── Step 1: Attempt EXIF GPS extraction (JPEG only) ──────────────────────────
  let exifCoords = null;
  if (/\.(jpe?g)$/i.test(file.name)) {
    exifCoords = await extractExifGpsFromFile(file);
  }

  // ── Step 2: Resolve coordinates ───────────────────────────────────────────────
  if (exifCoords) {
    // EXIF GPS found — use it directly
    AppState.customLat = exifCoords.lat;
    AppState.customLon = exifCoords.lon;
    if (customLatInput) customLatInput.value = exifCoords.lat.toFixed(5);
    if (customLonInput) customLonInput.value = exifCoords.lon.toFixed(5);
  } else if (mapInstance && customLatInput && customLonInput) {
    // Fallback: use current map center coordinates
    const center = mapInstance.getCenter();
    customLatInput.value = center.lat.toFixed(4);
    customLonInput.value = center.lng.toFixed(4);
    AppState.customLat = center.lat;
    AppState.customLon = center.lng;
  }

  const isPreviewable = /\.(png|jpe?g)$/i.test(file.name);

  if (isPreviewable) {
    const reader = new FileReader();
    reader.onload = (readerEvent) => {
      const dataUrl = readerEvent.target.result;
      AppState.uploadedImageUrl = dataUrl;

      // Build GPS badge markup
      const gpsBadge = exifCoords
        ? `<div style="margin-top:5px;display:inline-flex;align-items:center;gap:5px;
               background:rgba(62,214,232,0.15);border:1px solid rgba(62,214,232,0.4);
               border-radius:4px;padding:2px 7px;font-size:10.5px;color:#3ED6E8;">
               &#128207; GPS Extracted &nbsp;
               <span style="font-family:var(--mono);color:#fff;">
                 ${exifCoords.lat.toFixed(4)}° N, ${exifCoords.lon.toFixed(4)}° E
               </span>
             </div>`
        : `<div style="margin-top:5px;font-size:10px;color:var(--text-faint);">No EXIF GPS — using map center coordinates</div>`;

      if (content) {
        content.innerHTML = `
          <img class="upload-thumb" src="${dataUrl}" alt="preview" />
          <div class="upload-filename">${file.name}</div>
          ${gpsBadge}
          <span class="upload-clear" id="clearUpload">Remove Scene</span>
        `;
        document.getElementById('clearUpload').addEventListener('click', (evt) => {
          evt.stopPropagation();
          clearUpload();
        });
      }

      // Render image directly on map at detected / entered lat/lon bounds
      const bbox = computeBbox(AppState.customLat, AppState.customLon, 25.0);
      renderUploadedImageOnMap(dataUrl, bbox);

      // Fly map to the image location
      if (mapInstance) {
        mapInstance.flyTo([AppState.customLat, AppState.customLon], 11, { animate: true, duration: 1.2 });
      }
    };

    reader.readAsDataURL(file);
  } else {
    // GeoTIFF / other raster
    if (content) {
      content.innerHTML = `
        <div class="upload-filename">${file.name}<br><span style="color:var(--accent);">GeoTIFF detected — ready for Prithvi 2.0 classification</span></div>
        <span class="upload-clear" id="clearUpload">Remove Scene</span>
      `;
      document.getElementById('clearUpload').addEventListener('click', (evt) => {
        evt.stopPropagation();
        clearUpload();
      });
    }
  }

  resetAnalysisView();
}
