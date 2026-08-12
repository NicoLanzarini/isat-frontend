"use strict";

// Vista inicial centrada en Mendoza, Argentina (zona de interés del CEDIAC).
const INITIAL_CENTER = [-68.5, -34.6];
const INITIAL_ZOOM = 1.5;

// Capas base disponibles en el selector. Las de Esri exigen atribución propia.
const BASE_LAYERS = {
  osm: {
    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    maxzoom: 19,
    attribution: "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a>",
  },
  satellite: {
    tiles: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    ],
    maxzoom: 19,
    attribution:
      "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
  },
  topo: {
    tiles: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    ],
    maxzoom: 19,
    attribution: "Tiles &copy; Esri &mdash; Source: Esri, HERE, Garmin, and the GIS User Community",
  },
};

const sources = {};
const layers = [];
for (const [id, def] of Object.entries(BASE_LAYERS)) {
  sources[id] = {
    type: "raster",
    tiles: def.tiles,
    tileSize: 256,
    maxzoom: def.maxzoom,
    attribution: def.attribution,
  };
  layers.push({
    id,
    type: "raster",
    source: id,
    layout: { visibility: id === "osm" ? "visible" : "none" },
  });
}

const map = new maplibregl.Map({
  container: "map",
  center: INITIAL_CENTER,
  zoom: INITIAL_ZOOM,
  style: {
    version: 8,
    projection: { type: "globe" },
    sources,
    layers,
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
map.addControl(new maplibregl.GlobeControl(), "top-left");
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

// --- Selector de capas -------------------------------------------------------

const layerSwitcher = document.getElementById("layer-switcher");
const switcherToggle = layerSwitcher.querySelector(".layer-switcher-toggle");

switcherToggle.addEventListener("click", () => {
  const open = layerSwitcher.classList.toggle("open");
  switcherToggle.setAttribute("aria-expanded", String(open));
});

// Cerrar el panel al hacer clic fuera de él.
document.addEventListener("click", (event) => {
  if (!layerSwitcher.contains(event.target)) {
    layerSwitcher.classList.remove("open");
    switcherToggle.setAttribute("aria-expanded", "false");
  }
});

for (const radio of layerSwitcher.querySelectorAll("input[name='base-layer']")) {
  radio.addEventListener("change", () => {
    for (const id of Object.keys(BASE_LAYERS)) {
      map.setLayoutProperty(id, "visibility", id === radio.value ? "visible" : "none");
    }
  });
}

// --- Botones flotantes -------------------------------------------------------

const toast = document.getElementById("toast");
let toastTimer;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2500);
}

document.getElementById("btn-chart").addEventListener("click", () => {
  showToast("Series temporales: disponible próximamente");
});

document.getElementById("btn-filters").addEventListener("click", () => {
  showToast("Filtros: disponible próximamente");
});

document.getElementById("btn-refresh").addEventListener("click", () => {
  // Cuando el backend esté conectado, acá se recargarán los datos de la API.
  showToast("Sin datos para refrescar todavía");
});
