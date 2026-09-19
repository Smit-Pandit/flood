# FloodWatch: Satellite-Based Flood Extent and Exposure Monitoring

## Project Report

**Project type:** Web-based geospatial decision-support system  
**Technology stack:** HTML/CSS/JavaScript, FastAPI, NumPy, Rasterio, Shapely, Leaflet  
**Prepared for:** Project submission  

> Formatting note: when exported with 11 pt Calibri/Times New Roman, 1.15 line spacing and normal A4 margins, this report is designed to remain within ten pages.

## Abstract

FloodWatch is a web application for visualising potential flood extent from satellite imagery and estimating the population likely to be exposed. It combines a browser-based monitoring dashboard with a FastAPI service that processes preset areas or uploaded scenes. The application supports Assam's Brahmaputra Basin, Bihar's Kosi River area, and Kerala's Periyar Basin, while also allowing GeoTIFF, PNG and JPG inputs. The system produces a classified water mask, converts it to WGS84 GeoJSON, calculates inundated and permanent-water area, and derives an indicative exposure estimate from local population density.

The implementation includes a live optical workflow that retrieves Sentinel-2 Level-2A scenes from a public STAC catalogue and applies NDWI/MNDWI water-index rules. It also includes transparent fallback paths for unavailable imagery, generic uploaded images, and offline frontend use. At its current stage, FloodWatch is best treated as a monitoring prototype and decision-support interface, not as a validated operational flood-warning product. A compatible flood-finetuned Prithvi segmentation checkpoint is not included in the repository; therefore the project labels model availability and fallback methods explicitly.

**Keywords:** flood mapping, Sentinel-2, SAR, GeoTIFF, NDWI, GeoJSON, FastAPI, geospatial analysis.

## 1. Introduction

Flood assessment often depends on reports that arrive after the event, while satellite data can provide a broad view of inundation across inaccessible areas. However, raw imagery is difficult to interpret quickly, especially when users need a map, usable area estimates and an initial picture of humanitarian impact in one place. FloodWatch addresses this gap with a lightweight browser interface and a geospatial processing backend.

The project is designed around three practical requirements: accept satellite scenes in common formats, place results at the correct geographic location, and present outputs in terms that are useful to field coordination. The result is not only a water mask. It is a map layer with estimated flooded area, permanent-water area, population exposure, evacuation priority and likely affected settlements.

## 2. Objectives

The main objective is to develop an interactive flood-monitoring prototype that transforms satellite imagery into mapped water classes and basic impact indicators.

Specific objectives are:

- provide preset monitoring views for selected Indian flood-prone regions;
- retrieve and analyse Sentinel-2 optical data when available;
- accept uploaded GeoTIFF, JPEG and PNG scenes;
- extract location information from GeoTIFF coordinates, image EXIF data or user input;
- export classified regions as geographically referenced GeoJSON; and
- estimate exposed population using flooded area and a configurable density value.

## 3. System Design and Architecture

FloodWatch follows a client-server design. The frontend is responsible for interaction and visualisation, while the backend performs image processing, spatial conversion and impact estimation.

| Layer | Main components | Responsibility |
|---|---|---|
| Presentation | HTML, modular CSS, JavaScript | Controls, results panel, upload handling and run log |
| Mapping | Leaflet and Esri imagery tiles | Basemap, coordinate display and flood-polygon overlay |
| API | FastAPI with CORS enabled | Region, health and prediction endpoints |
| Processing | NumPy, Rasterio, Pillow, Shapely | Raster reading, water classification, area calculation and GeoJSON generation |
| Data access | STAC client and AWS Earth Search | Sentinel-2 Level-2A scene discovery and band retrieval |

The workflow begins when the user chooses a preset basin or uploads an image. For a preset region with the optical option selected, the API searches Sentinel-2 L2A scenes in a 40-day window centred on the requested date and selects the least-cloudy scene, initially preferring cloud cover below 40%. Six spectral bands are read from cloud-optimised GeoTIFF assets, reprojected to WGS84 and resampled to a 224 × 224 analysis window.

For an upload, the system first determines the area of interest. A GeoTIFF with a valid coordinate reference system takes priority because its bounds can be reprojected accurately to WGS84. If that is not available, EXIF GPS coordinates are used; failing that, the map/user coordinates are used. The software then forms an approximate bounding box from the centre and selected span.

## 4. Methodology

### 4.1 Water classification

For live Sentinel-2 data, FloodWatch uses the Normalized Difference Water Index (NDWI) and Modified NDWI (MNDWI):

\[
NDWI = \frac{Green - NIR}{Green + NIR}, \qquad
MNDWI = \frac{Green - SWIR1}{Green + SWIR1}
\]

Pixels satisfying `NDWI > 0.05` or `MNDWI > 0.00` are first marked as water candidates. Pixels with `NDWI > 0.25` and `MNDWI > 0.15` are assigned to the permanent-water class. The remaining detected water is reported as inundated/flood water. This is a rule-based water-index method, so it identifies water signatures rather than proving that a particular pixel was newly flooded.

Uploaded Sentinel-2-like GeoTIFFs use the same index approach where sufficient bands are available. Uploaded Sentinel-1-style rasters use a low-backscatter water-candidate heuristic. Ordinary RGB uploads use luminance thresholds, which are useful for demonstrating the pipeline but are sensitive to shadows, colour balance and land cover. Reference label files are identified and reported as reference masks, rather than being misrepresented as predictions.

### 4.2 Spatial processing

The classifier returns a two-dimensional, three-class mask: dry land (0), inundated water (1) and permanent water (2). Connected pixel groups are identified for each water class. Their outlines are converted from pixel position to longitude/latitude using the image bounding box:

\[
lon = minLon + \frac{column}{width}(maxLon-minLon)
\]

\[
lat = maxLat - \frac{row}{height}(maxLat-minLat)
\]

The polygons are simplified while preserving topology, then packaged as GeoJSON features. A local latitude-adjusted conversion is used to calculate area in square kilometres. This is suitable for the project-scale areas used in the prototype; a production system should use an equal-area projected CRS for more rigorous area reporting.

### 4.3 Exposure estimation

FloodWatch estimates exposed population using:

\[
P_{exposed}=A_{flood}\times D\times 0.85
\]

where \(A_{flood}\) is inundated area in km², \(D\) is selected population density in people/km², and 0.85 is an adjustment for non-residential land distribution. The current prototype also estimates immediate evacuation priority as 38% of the exposed population and approximates affected settlements as one habitation per 4.2 km² of flooded area. Severity is marked low, moderate or severe at area thresholds of 250 km² and 800 km².

These figures are planning indicators, not official casualty, displacement or population counts. Reliable operational impact analysis would require gridded population, building footprints, road networks, elevation and local validation data.

## 5. Implementation

The frontend is split into small modules for configuration, maps, upload handling, comparison display, inference requests and application event binding. This makes the dashboard easier to maintain than a single large script. Leaflet renders the map, administrative context and returned GeoJSON. The user can choose a region, imagery type and density, alter overlay opacity, view the pointer coordinates, and inspect a timestamped run log.

The backend exposes the following core interfaces:

| Endpoint | Method | Purpose |
|---|---|---|
| `/health` | GET | Reports server and model/fallback status |
| `/api/regions` | GET | Returns preset region metadata |
| `/api/predict` | POST | Analyses a selected preset region |
| `/api/predict/upload` | POST | Analyses an uploaded scene and its location |

The API response includes the selected source and mode, bounding box, processing time, water statistics, impact estimate, GeoJSON, timestamp and the exact inference method used. Returning the method is important: it allows the interface to distinguish a live optical water-index result, a label-reference mask, an uploaded-image heuristic or a demonstration fallback.

Preset site metadata currently covers Assam, Bihar and Kerala. Each record contains a bounding box, centre point, default density, zoom level and baseline risk label. The project also includes a 90-second frontend timeout and an offline demonstration fallback, so the interface remains usable when the local API or remote data source is unavailable.

## 6. Testing and Current Behaviour

Testing should be performed at three levels. First, API checks confirm that the service starts, reports its state through `/health`, validates region keys and returns valid JSON. Second, upload tests should use a georeferenced GeoTIFF, a GPS-tagged image and an image with manually supplied coordinates to verify the location-priority logic. Third, map tests should confirm that returned polygons are rendered at the expected location and that class totals are displayed correctly.

The implementation deliberately exposes its current limitations. The configured NASA–IBM Prithvi-EO-2.0 identifier is present as a foundation-model target, but the repository does not contain the compatible flood segmentation head/checkpoint needed to run Prithvi inference. Consequently, the live optical path currently uses NDWI/MNDWI rules and other sources use the labelled heuristic or demonstration paths described above. The confidence values shown by these paths should therefore not be interpreted as independently calibrated model probabilities.

## 7. Results and Discussion

The main result is an end-to-end geospatial workflow: a user can select a basin or upload a scene, obtain geographically placed water polygons and receive an immediate, readable summary of potential impact. This is particularly useful as a dashboard demonstration because it combines sensing, mapping and basic decision support rather than stopping at image classification.

The strongest technical feature is traceability. GeoTIFF geotransforms are preferred over approximate user coordinates, actual Sentinel scene date and cloud cover are retained when data retrieval succeeds, and the response records the method that produced the mask. Separating inundated water from permanent water also prevents all observed water from being reported as a flood.

The principal weakness is validation. Threshold-based indices may confuse cloud shadow, wet soil, dark surfaces and permanent water with inundation. SAR fallback based on low backscatter can similarly be affected by smooth surfaces and acquisition conditions. The spatial fallback for preset regions is only a demonstration mechanism and must not be used for real flood reporting. In addition, the exposure formula assumes uniform density, which is rarely true near rivers, urban areas and agricultural land.

## 8. Future Enhancements

The next development priority is integration of a flood-finetuned Prithvi segmentation model with published preprocessing, class definitions and evaluation data. This should be followed by validation against held-out labelled events using intersection-over-union, precision, recall and F1-score. A change-detection workflow using pre- and post-event Sentinel-1 SAR would improve operation during cloud cover and better separate permanent water from new inundation.

Further improvements should include an equal-area CRS for area measurement, confidence calibration, tile-based processing for larger scenes, authentication and rate limiting for deployment, persistent run records, and exposure analysis based on WorldPop-style grids, roads, buildings and critical infrastructure. The dashboard should retain the present provenance labels so that users can see the sensor, scene date, cloud cover and processing method behind every result.

## 9. Conclusion

FloodWatch demonstrates a practical pipeline for converting satellite imagery into visual flood-related information. Its modular interface, geolocation handling, GeoJSON output and exposure summary make the system understandable to both technical users and first-level decision makers. The project has a sound foundation for a more capable flood-monitoring platform, especially because it already separates permanent water from possible inundation and records how a result was produced.

At the same time, the current system should be described accurately as a prototype. Water-index and heuristic results provide useful screening information, but operational decisions require a validated flood segmentation model, reliable multi-temporal imagery and local ground verification. With those additions, FloodWatch can progress from an interactive demonstration to a defensible geospatial decision-support tool.

## References

1. McFeeters, S. K. (1996). The use of the Normalized Difference Water Index in the delineation of open water features. *International Journal of Remote Sensing*, 17(7), 1425–1432.
2. Xu, H. (2006). Modification of normalised difference water index for open water features. *International Journal of Remote Sensing*, 27(14), 3025–3033.
3. European Space Agency. Sentinel-2 User Handbook.
4. NASA–IBM. Prithvi-EO-2.0 geospatial foundation model documentation.
5. Open Geospatial Consortium. GeoJSON Standard (RFC 7946).
