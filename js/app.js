/**
 * FloodWatch Application Entry Point
 * Orchestrates event listeners, UI bindings, and module initialization.
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialize Map and Basemaps
  initMap();

  // 2. Setup Compare Drag Listeners
  setupCompareDrag();

  // 3. Setup Custom Upload Handlers
  setupUploadHandlers();

  // 4. Region Dropdown Selector
  const regionSelect = document.getElementById('regionSelect');
  if (regionSelect) {
    regionSelect.addEventListener('change', (e) => {
      AppState.currentRegion = e.target.value;
      const region = REGIONS[AppState.currentRegion];
      const densitySlider = document.getElementById('densitySlider');
      const densityValue = document.getElementById('densityValue');
      if (region && densitySlider) {
        const density = region.populationDensity;
        densitySlider.value = density;
        AppState.populationDensity = density;
        if (densityValue) densityValue.textContent = `${density.toLocaleString('en-IN')} / km²`;
      }
      drawRegionOutline(AppState.currentRegion);
      resetAnalysisView();
    });
  }

  const densitySlider = document.getElementById('densitySlider');
  const densityValue = document.getElementById('densityValue');
  if (densitySlider) {
    densitySlider.addEventListener('input', (e) => {
      const density = Number(e.target.value);
      AppState.populationDensity = density;
      if (densityValue) densityValue.textContent = `${density.toLocaleString('en-IN')} / km²`;
    });
  }

  // 5. Opacity Slider
  const opacitySlider = document.getElementById('opacitySlider');
  const opacityValue = document.getElementById('opacityValue');
  if (opacitySlider) {
    opacitySlider.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      if (opacityValue) opacityValue.textContent = `${val}%`;
      updateFloodMaskOpacity(val / 100);

      if (AppState.usingCustomImage && AppState.maskBlobs) {
        renderMaskBlobs();
      }
    });
  }

  // 6. Imagery Source Toggle Buttons (SAR vs Optical)
  const sourceButtons = document.querySelectorAll('[data-source]');
  sourceButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      sourceButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      AppState.currentSource = btn.dataset.source;
    });
  });

  // 7. Mode Toggle Buttons (Single vs Before/After Change)
  const modeButtons = document.querySelectorAll('[data-mode]');
  modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      modeButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      AppState.currentMode = btn.dataset.mode;

      if (AppState.currentMode === 'change') {
        enableCompareMode();
      } else {
        disableCompareMode();
      }
    });
  });

  // 8. Run Flood Detection Action Trigger
  const runBtn = document.getElementById('runBtn');
  if (runBtn) {
    runBtn.addEventListener('click', handleRun);
  }
});
