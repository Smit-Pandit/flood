/**
 * FloodWatch Before / After Compare Module
 * Handles interactive split-screen slider comparison between baseline satellite imagery
 * and the recent uploaded satellite scene + classified Prithvi 2.0 flood masks on the Leaflet map.
 */

/**
 * Clips the flood-mask layer and the uploaded image layer so only the area right of the handle
 * shows the recent scene + classified flood mask ("After / Recent"); left shows the baseline basemap ("Before").
 * @param {number} percent - Position percentage (0 to 100)
 */
function applyCompareClip(percent) {
  const clipValue = AppState.compareMode ? `inset(0 0 0 ${percent}%)` : 'none';

  if (mapInstance) {
    // 1. Clip the classified flood mask pane
    const floodPane = mapInstance.getPane('floodPane');
    if (floodPane) floodPane.style.clipPath = clipValue;

    // 2. Clip the uploaded recent satellite image overlay pane
    const imagePane = mapInstance.getPane('imageOverlayPane');
    if (imagePane) imagePane.style.clipPath = clipValue;
  }
}

/**
 * Updates the compare slider handle position and applies the clip path.
 * @param {number} percent - Position percentage (0 to 100)
 */
function setCompareHandlePosition(percent) {
  AppState.comparePercent = Math.max(0, Math.min(100, percent));
  const handle = document.getElementById('compareHandle');
  if (handle) {
    handle.style.left = `${AppState.comparePercent}%`;
  }
  applyCompareClip(AppState.comparePercent);
}

/**
 * Enables Before/After comparison mode.
 */
function enableCompareMode() {
  AppState.compareMode = true;
  const slider = document.getElementById('compareSlider');
  if (slider) slider.style.display = 'block';
  setCompareHandlePosition(AppState.comparePercent);
}

/**
 * Disables comparison mode and restores full overlay view.
 */
function disableCompareMode() {
  AppState.compareMode = false;
  const slider = document.getElementById('compareSlider');
  if (slider) slider.style.display = 'none';
  applyCompareClip(AppState.comparePercent);
}

/**
 * Binds mouse and touch drag events to the split comparison handle.
 */
function setupCompareDrag() {
  const handle = document.getElementById('compareHandle');
  const wrap = document.querySelector('.map-wrap');
  if (!handle || !wrap) return;

  let dragging = false;

  function percentFromClientX(clientX) {
    const rect = wrap.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * 100;
  }

  function onMove(clientX) {
    setCompareHandlePosition(percentFromClientX(clientX));
  }

  // Mouse Drag Events
  handle.addEventListener('mousedown', () => { dragging = true; });
  window.addEventListener('mousemove', (e) => {
    if (dragging) onMove(e.clientX);
  });
  window.addEventListener('mouseup', () => { dragging = false; });

  // Touch Drag Events (Mobile / Tablet support)
  handle.addEventListener('touchstart', () => { dragging = true; }, { passive: true });
  window.addEventListener('touchmove', (e) => {
    if (dragging && e.touches && e.touches[0]) {
      onMove(e.touches[0].clientX);
    }
  }, { passive: true });
  window.addEventListener('touchend', () => { dragging = false; });
}
