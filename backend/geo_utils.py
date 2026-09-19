"""
Geospatial & Demographic Utilities for FloodWatch
Extracts geolocation (lat/lon) from GeoTIFF/EXIF metadata, converts 2D segmentation masks
into real geographic GeoJSON polygon coordinates (WGS84), and computes multi-class area
and detailed demographic / population exposure estimations based on WorldPop / Census densities.
"""

import math
import io
import numpy as np
from typing import List, Dict, Any, Tuple, Optional
from PIL import Image, ExifTags
from shapely.geometry import Polygon, MultiPolygon, mapping
from shapely.ops import unary_union

def extract_geotiff_coords(file_bytes: bytes) -> Optional[Tuple[float, float, List[float]]]:
    """
    Extracts the center latitude, longitude, and bounding box from a GeoTIFF
    file using rasterio's geotransform + CRS metadata.

    Returns: (center_lat, center_lon, [min_lat, min_lon, max_lat, max_lon]) or None
    Requires: rasterio, pyproj (installed via requirements.txt)
    """
    try:
        import rasterio
        from rasterio.io import MemoryFile
        from rasterio.crs import CRS
        from rasterio.warp import transform_bounds

        with MemoryFile(file_bytes) as memfile:
            with memfile.open() as dataset:
                # Must have valid CRS to reproject
                if dataset.crs is None:
                    return None

                src_crs = dataset.crs
                wgs84 = CRS.from_epsg(4326)  # WGS84

                # Get bounds in source CRS then reproject to WGS84
                left, bottom, right, top = dataset.bounds
                min_lon, min_lat, max_lon, max_lat = transform_bounds(
                    src_crs, wgs84, left, bottom, right, top
                )

                center_lat = round((min_lat + max_lat) / 2.0, 6)
                center_lon = round((min_lon + max_lon) / 2.0, 6)
                bbox = [
                    round(min_lat, 5), round(min_lon, 5),
                    round(max_lat, 5), round(max_lon, 5)
                ]
                return center_lat, center_lon, bbox
    except Exception:
        return None


def extract_exif_gps(image: Image.Image) -> Optional[Tuple[float, float]]:

    """
    Extracts GPS latitude and longitude from image EXIF metadata if present.
    Returns: (lat, lon) or None
    """
    try:
        exif = image._getexif()
        if not exif:
            return None
            
        gps_info = {}
        for tag_id, value in exif.items():
            tag_name = ExifTags.TAGS.get(tag_id, tag_id)
            if tag_name == "GPSInfo":
                for gps_tag_id, gps_val in value.items():
                    gps_tag_name = ExifTags.GPSTAGS.get(gps_tag_id, gps_tag_id)
                    gps_info[gps_tag_name] = gps_val
                    
        if "GPSLatitude" in gps_info and "GPSLongitude" in gps_info:
            lat_dms = gps_info["GPSLatitude"]
            lon_dms = gps_info["GPSLongitude"]
            lat_ref = gps_info.get("GPSLatitudeRef", "N")
            lon_ref = gps_info.get("GPSLongitudeRef", "E")
            
            def dms_to_deg(dms):
                return float(dms[0]) + float(dms[1]) / 60.0 + float(dms[2]) / 3600.0
                
            lat = dms_to_deg(lat_dms)
            if lat_ref != "N":
                lat = -lat
                
            lon = dms_to_deg(lon_dms)
            if lon_ref != "E":
                lon = -lon
                
            return round(lat, 5), round(lon, 5)
    except Exception:
        pass
    return None

def calculate_bbox_from_center(center_lat: float, center_lon: float, span_km: float = 25.0) -> List[float]:
    """
    Calculates geographic bounding box [min_lat, min_lon, max_lat, max_lon]
    from a central latitude and longitude and an approximate span in kilometers.
    """
    lat_deg_span = span_km / 111.139
    lon_deg_span = span_km / (111.139 * math.cos(math.radians(center_lat)))
    
    min_lat = round(center_lat - (lat_deg_span / 2.0), 5)
    max_lat = round(center_lat + (lat_deg_span / 2.0), 5)
    min_lon = round(center_lon - (lon_deg_span / 2.0), 5)
    max_lon = round(center_lon + (lon_deg_span / 2.0), 5)
    
    return [min_lat, min_lon, max_lat, max_lon]

def pixel_to_geo(row: float, col: float, height: int, width: int, bbox: List[float]) -> Tuple[float, float]:
    """
    Transforms pixel grid coordinates (row, col) to real geographical coordinates (lon, lat).
    bbox: [min_lat, min_lon, max_lat, max_lon]
    """
    min_lat, min_lon, max_lat, max_lon = bbox
    lon = min_lon + (col / width) * (max_lon - min_lon)
    lat = max_lat - (row / height) * (max_lat - min_lat)
    return round(lon, 5), round(lat, 5)

def extract_contours_for_class(mask_2d: np.ndarray, target_class: int, min_area_pixels: int = 15) -> List[List[Tuple[float, float]]]:
    """
    Extracts smoothed boundary polygons for a specific classification class.
    """
    height, width = mask_2d.shape
    binary = (mask_2d == target_class)
    visited = np.zeros((height, width), dtype=bool)
    contours = []
    
    for r in range(1, height - 1):
        for c in range(1, width - 1):
            if binary[r, c] and not visited[r, c]:
                queue = [(r, c)]
                visited[r, c] = True
                cluster_pixels = []
                
                while queue:
                    curr_r, curr_c = queue.pop(0)
                    cluster_pixels.append((curr_r, curr_c))
                    
                    for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                        nr, nc = curr_r + dr, curr_c + dc
                        if 0 <= nr < height and 0 <= nc < width:
                            if binary[nr, nc] and not visited[nr, nc]:
                                visited[nr, nc] = True
                                queue.append((nr, nc))
                                
                if len(cluster_pixels) >= min_area_pixels:
                    cluster_arr = np.array(cluster_pixels)
                    min_r, max_r = cluster_arr[:, 0].min(), cluster_arr[:, 0].max()
                    min_c, max_c = cluster_arr[:, 1].min(), cluster_arr[:, 1].max()
                    
                    num_radial_samples = 18
                    center_r = (min_r + max_r) / 2.0
                    center_c = (min_c + max_c) / 2.0
                    
                    polygon_pts = []
                    for angle_idx in range(num_radial_samples):
                        angle = (angle_idx / num_radial_samples) * 2 * math.pi
                        dir_r = math.sin(angle)
                        dir_c = math.cos(angle)
                        
                        max_dist = 0
                        best_pt = (center_r, center_c)
                        for pr, pc in cluster_pixels:
                            dot = (pr - center_r) * dir_r + (pc - center_c) * dir_c
                            if dot > max_dist:
                                max_dist = dot
                                best_pt = (pr, pc)
                                
                        if max_dist > 0:
                            polygon_pts.append(best_pt)
                            
                    if len(polygon_pts) >= 4:
                        polygon_pts.append(polygon_pts[0])
                        contours.append(polygon_pts)
                        
    return contours

def calculate_geodesic_area(polygon: Polygon, center_lat: float) -> float:
    """
    Computes accurate surface area in square kilometers (km²) from lat/lon polygon.
    """
    lat_scale = 111.139
    lon_scale = 111.139 * math.cos(math.radians(center_lat))
    coords = list(polygon.exterior.coords)
    if len(coords) < 3:
        return 0.0
    metric_coords = [(lon * lon_scale, lat * lat_scale) for lon, lat in coords]
    return abs(Polygon(metric_coords).area)

def multi_class_mask_to_geojson(
    class_mask: np.ndarray,
    bbox: List[float],
    confidence_map: Optional[np.ndarray] = None,
    site_id: str = "custom_scene"
) -> Tuple[Dict[str, Any], Dict[str, float]]:
    """
    Converts multi-class segmentation mask into real WGS84 GeoJSON features:
    Class 1: Flood Water (accent cyan)
    Class 2: Permanent Water Body (deep blue)
    """
    height, width = class_mask.shape
    center_lat = (bbox[0] + bbox[2]) / 2.0
    features = []
    area_stats = {"flood_water_km2": 0.0, "permanent_water_km2": 0.0, "total_area_km2": 0.0}
    
    class_meta = {
        1: {
            "type_name": "Flood Water (Inundated)",
            "code": "flood_water",
            "color": "#3ED6E8",
            "opacity": 0.75,
            "stat_key": "flood_water_km2"
        },
        2: {
            "type_name": "Permanent Water Body (River / Basin)",
            "code": "permanent_water",
            "color": "#274156",
            "opacity": 0.85,
            "stat_key": "permanent_water_km2"
        }
    }
    
    for class_id, meta in class_meta.items():
        contours = extract_contours_for_class(class_mask, target_class=class_id, min_area_pixels=15)
        shapely_polygons = []
        
        for contour in contours:
            geo_coords = [pixel_to_geo(r, c, height, width, bbox) for r, c in contour]
            if len(geo_coords) >= 4:
                poly = Polygon(geo_coords)
                if poly.is_valid and poly.area > 0:
                    shapely_polygons.append(poly)
                    
        if shapely_polygons:
            unified = unary_union(shapely_polygons)
            polys_to_export = [unified] if isinstance(unified, Polygon) else list(unified.geoms)
            
            for idx, poly in enumerate(polys_to_export):
                simplified = poly.simplify(0.002, preserve_topology=True)
                area_km2 = calculate_geodesic_area(simplified, center_lat)
                area_stats[meta["stat_key"]] += area_km2
                
                features.append({
                    "type": "Feature",
                    "id": f"{site_id}_{meta['code']}_{idx+1}",
                    "properties": {
                        "id": f"{meta['code']}_{idx+1}",
                        "class_id": class_id,
                        "water_type": meta["type_name"],
                        "category": meta["code"],
                        "color": meta["color"],
                        "opacity": meta["opacity"],
                        "area_km2": round(area_km2, 2),
                        "sensor": "Sentinel-1 SAR / Prithvi-EO-2.0"
                    },
                    "geometry": mapping(simplified)
                })
                
    area_stats["flood_water_km2"] = round(area_stats["flood_water_km2"], 1)
    area_stats["permanent_water_km2"] = round(area_stats["permanent_water_km2"], 1)
    area_stats["total_area_km2"] = round(area_stats["flood_water_km2"] + area_stats["permanent_water_km2"], 1)
    
    geojson = {
        "type": "FeatureCollection",
        "bbox": bbox,
        "features": features
    }
    
    return geojson, area_stats

def format_indian_number(count: int) -> str:
    """Formats an integer into Indian comma style (e.g. 2,45,000)."""
    s = str(count)
    if len(s) <= 3:
        return s
    last_three = s[-3:]
    remaining = s[:-3]
    parts = []
    while len(remaining) > 2:
        parts.insert(0, remaining[-2:])
        remaining = remaining[:-2]
    if remaining:
        parts.insert(0, remaining)
    return ",".join(parts) + "," + last_three

def estimate_impact(flooded_area_km2: float, density_per_sqkm: int = 550) -> Dict[str, Any]:
    """
    Computes comprehensive demographic impact and exposed population estimation:
    - Exposed population = Flooded Area (km²) * Density (people/km²) * Inundation Factor (0.85)
    - Immediate evacuation priority = ~38% in critical deep-inundation zones
    - Settlements impacted = Estimated villages/wards submerged
    """
    # Inundation factor considers non-residential rural distribution
    raw_exposed = int(flooded_area_km2 * (density_per_sqkm * 0.85))
    
    if raw_exposed >= 100000:
        pop_str = f"{raw_exposed / 100000:.2f} Lakh"
        short_str = f"{raw_exposed / 100000:.1f}L"
    elif raw_exposed >= 1000:
        pop_str = f"{raw_exposed / 1000:.1f} Thousand"
        short_str = f"{raw_exposed / 1000:.1f}K"
    else:
        pop_str = str(raw_exposed)
        short_str = str(raw_exposed)
        
    evacuate_count = int(raw_exposed * 0.38)
    if evacuate_count >= 100000:
        evacuate_str = f"{evacuate_count / 100000:.1f}L people"
    elif evacuate_count >= 1000:
        evacuate_str = f"{evacuate_count / 1000:.1f}K people"
    else:
        evacuate_str = f"{evacuate_count} people"

    settlements_count = max(1, int(flooded_area_km2 / 4.2))

    if flooded_area_km2 > 800:
        severity = "severe"
    elif flooded_area_km2 > 250:
        severity = "moderate"
    else:
        severity = "low"
        
    return {
        "area_km2": flooded_area_km2,
        "population_exposed": short_str,
        "population_exposed_full": pop_str,
        "population_raw_count": raw_exposed,
        "population_formatted": format_indian_number(raw_exposed),
        "evacuation_priority": evacuate_str,
        "settlements_impacted": f"~{settlements_count} habitations",
        "density_applied": f"{density_per_sqkm} / km²",
        "severity": severity
    }
