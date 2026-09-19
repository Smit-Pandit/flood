/**
 * FloodWatch Map Module
 * Handles Leaflet initialization, satellite tile layers, coordinate HUD,
 * georeferenced custom image overlay, and multi-class Prithvi 2.0 GeoJSON rendering.
 */

let mapInstance = null;
let baseTileLayer = null;
let referenceTileLayer = null;
let floodVectorLayer = null;
let uploadedImageLayer = null;

/**
 * Initializes the Leaflet map, basemaps, panes, and coordinate tracking HUD.
 */
function initMap() {
  const initialRegion = REGIONS[AppState.currentRegion];

  mapInstance = L.map('map', {
    zoomControl: true,
    attributionControl: true
  }).setView(initialRegion.center, initialRegion.zoom);

  // Esri World Imagery Basemap
  baseTileLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS community',
      maxZoom: 19
    }
  ).addTo(mapInstance);

  // Reference layer: place labels & boundaries
  referenceTileLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    {
      maxZoom: 19,
      opacity: 0.9
    }
  ).addTo(mapInstance);

  // Dedicated Panes for layering and Before/After slider clipping
  // 1. Pane for uploaded satellite image scene (under the flood mask)
  mapInstance.createPane('imageOverlayPane');
  mapInstance.getPane('imageOverlayPane').style.zIndex = 420;

  // 2. Pane for classified flood mask polygons (on top of image/basemap)
  mapInstance.createPane('floodPane');
  mapInstance.getPane('floodPane').style.zIndex = 450;

  // Live coordinate HUD tracker on mouse move
  mapInstance.on('mousemove', (e) => {
    const coordEl = document.getElementById('coordLabel');
    if (coordEl) {
      coordEl.innerHTML = `LAT <span class="coord">${e.latlng.lat.toFixed(4)}</span> &nbsp; LON <span class="coord">${e.latlng.lng.toFixed(4)}</span>`;
    }
  });

  // Draw initial faint AOI boundary outline
  drawRegionOutline(AppState.currentRegion);
}

/**
 * Renders an uploaded satellite image directly ON the Leaflet map at its geographic bounds.
 * @param {string} imageUrl - Data URL or image source URL
 * @param {Array<number>} bbox - [min_lat, min_lon, max_lat, max_lon]
 */
function renderUploadedImageOnMap(imageUrl, bbox) {
  clearUploadedImageFromMap();
  if (!imageUrl || !bbox) return;

  const latLngBounds = L.latLngBounds(
    [bbox[0], bbox[1]],  // Southwest
    [bbox[2], bbox[3]]   // Northeast
  );

  uploadedImageLayer = L.imageOverlay(imageUrl, latLngBounds, {
    pane: 'imageOverlayPane',
    opacity: 0.92,
    interactive: true
  }).addTo(mapInstance);

  AppState.uploadedBbox = bbox;
  mapInstance.fitBounds(latLngBounds, { padding: [30, 30], maxZoom: 13 });
}

/**
 * Removes custom uploaded image overlay from the map.
 */
function clearUploadedImageFromMap() {
  if (uploadedImageLayer) {
    mapInstance.removeLayer(uploadedImageLayer);
    uploadedImageLayer = null;
  }
}

/**
 * Renders a dashed outline representing the Area of Interest (AOI) before inference.
 * @param {string} regionKey - The key of the region ('assam' | 'bihar' | 'kerala')
 */
function drawRegionOutline(regionKey) {
  if (floodVectorLayer) {
    mapInstance.removeLayer(floodVectorLayer);
    floodVectorLayer = null;
  }
  const region = REGIONS[regionKey];
  if (!region) return;

  mapInstance.setView(region.center, region.zoom);

  floodVectorLayer = L.polygon(region.polygon, {
    pane: 'floodPane',
    color: '#3ED6E8',
    weight: 1.5,
    opacity: 0.4,
    fillOpacity: 0,
    dashArray: '4, 5'
  }).addTo(mapInstance);
}

/**
 * Renders the filled multi-class flood mask using either server-generated GeoJSON or local polygon fallback.
 * @param {string} regionKey - The key of the region
 * @param {Object} [geojsonData] - Multi-class GeoJSON FeatureCollection returned by Prithvi 2.0 backend
 */
function drawFloodMask(regionKey, geojsonData = null) {
  if (floodVectorLayer) {
    mapInstance.removeLayer(floodVectorLayer);
    floodVectorLayer = null;
  }

  if (geojsonData && geojsonData.type === "FeatureCollection") {
    // Render true multi-class GeoJSON features from Prithvi 2.0 Backend
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
          const popupContent = `
            <div style="font-family:var(--sans); font-size:12px; color:#111; padding:4px;">
              <strong style="color:${props.color || '#0088cc'}; font-size:13px;">${props.water_type || 'Classified Water Body'}</strong><br/>
              Classification: <strong>${props.category === 'flood_water' ? 'Recent Inundation' : 'River / Basin'}</strong><br/>
              Surface Area: <strong>${props.area_km2 || '—'} km²</strong><br/>
              Model: <span style="font-size:10.5px; color:#555;">${props.sensor || 'Prithvi-EO-2.0'}</span>
            </div>
          `;
          layer.bindPopup(popupContent);
        }
      }
    }).addTo(mapInstance);
    floodVectorLayer.bringToFront();

    if (geojsonData.bbox) {
      const b = geojsonData.bbox;
      mapInstance.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: [25, 25] });
    }
    return;
  }

  // Fallback to local region polygon
  const region = REGIONS[regionKey];
  if (!region) return;

  floodVectorLayer = L.polygon(region.polygon, {
    pane: 'floodPane',
    color: '#3ED6E8',
    weight: 2,
    opacity: 0.9,
    fillColor: '#3ED6E8',
    fillOpacity: AppState.maskOpacity * 0.55
  }).addTo(mapInstance);
}

/*
 * Updates the opacity of the active flood layer polygon.
 * @param {number} opacity - Decimal opacity value between 0.0 and 1.0
 */
function updateFloodMaskOpacity(opacity) {
  AppState.maskOpacity = opacity;
  if (!floodVectorLayer) return;

  if (typeof floodVectorLayer.setStyle === 'function') {
    floodVectorLayer.setStyle((feature) => {
      const props = (feature && feature.properties) || {};
      const isFlood = props.category === 'flood_water' || props.class_id === 1;
      return {
        fillOpacity: AppState.maskOpacity * (isFlood ? 0.6 : 0.85)
      };
    });
  }
}
