"use strict";

// Vista inicial centrada en Mendoza, Argentina (zona de interés del CEDIAC).
const INITIAL_CENTER = [-68.5, -34.6];
const INITIAL_ZOOM = 1.5;

const map = new maplibregl.Map({
  container: "map",
  center: INITIAL_CENTER,
  zoom: INITIAL_ZOOM,
  style: {
    version: 8,
    projection: { type: "globe" },
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 19,
        attribution: "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a>",
      },
    },
    layers: [
      {
        id: "osm",
        type: "raster",
        source: "osm",
      },
    ],
    sky: {
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0],
    },
    light: {
      anchor: "map",
      position: [1.5, 90, 80],
    },
  },
  attributionControl: { compact: false },
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-left");
map.addControl(new maplibregl.GlobeControl(), "top-right");
map.addControl(new maplibregl.ScaleControl(), "bottom-left");

// Alternar entre globo 3D y mapa plano 2D (mercator).
const toggleButton = document.getElementById("projection-toggle");
let isGlobe = true;

function applyProjection() {
  map.setProjection({ type: isGlobe ? "globe" : "mercator" });
  toggleButton.textContent = isGlobe ? "Ver mapa 2D" : "Ver globo 3D";
}

toggleButton.addEventListener("click", () => {
  isGlobe = !isGlobe;
  applyProjection();
});
