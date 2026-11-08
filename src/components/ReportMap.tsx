import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import L from "leaflet";
import { reportStatusLabel, type Report } from "../../shared/contracts";

interface ReportMapProps {
  reports: Report[];
  center?: { lat: number; lng: number };
  zoom?: number;
  filters?: {
    status?: string[];
    category?: string[];
    municipality?: string[];
    timeRange?: number; // days
  };
}

// Status colors for map markers
const STATUS_COLORS: Record<string, string> = {
  SUBMITTED: "#385575",
  UNDER_REVIEW: "#79520f",
  IN_PROGRESS: "#285e7e",
  RESOLVED: "#246147",
  CLOSED: "#526057",
};

// Persistent problem indicator color

function mapElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function clusterPopup(item: {
  count: number;
  reports: Report[];
}): HTMLElement {
  const root = mapElement("div", undefined, "map-popup cluster-popup");
  root.append(mapElement("h3", `${item.count} reports in this area`));
  const summary = item.reports.reduce<Record<string, number>>((counts, report) => {
    counts[report.status] = (counts[report.status] || 0) + 1;
    return counts;
  }, {});
  for (const [status, count] of Object.entries(summary)) {
    const line = mapElement("p");
    const dot = mapElement("span", undefined, "status-dot");
    dot.style.background = STATUS_COLORS[status] ?? "#526057";
    line.append(dot, document.createTextNode(`${reportStatusLabel(status as Report["status"])}: ${count}`));
    root.append(line);
  }
  root.append(mapElement("p", "Select the cluster to zoom in.", "muted"));
  return root;
}

// Cluster configuration
const CLUSTER_RADIUS_PX = 60;
const CLUSTER_MAX_ZOOM = 16;

export function ReportMap({ reports, center, zoom = 13, filters }: ReportMapProps) {
  const [hoveredReport, setHoveredReport] = useState<Report | null>(null);
  const [currentZoom, setCurrentZoom] = useState(zoom);
  const [showLegend, setShowLegend] = useState(true);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState("");
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Layer[]>([]);
  const userLocationMarkerRef = useRef<L.Marker | null>(null);

  // Filter reports based on filters
  const filteredReports = useMemo(() => {
    let filtered = reports.filter((report) => report.coordinates);

    if (filters?.status && filters.status.length > 0) {
      filtered = filtered.filter((report) => filters.status!.includes(report.status));
    }

    if (filters?.category && filters.category.length > 0) {
      filtered = filtered.filter((report) => filters.category!.includes(report.category.id));
    }

    if (filters?.municipality && filters.municipality.length > 0) {
      filtered = filtered.filter((report) =>
        report.municipality && filters.municipality!.includes(report.municipality.id)
      );
    }

    if (filters?.timeRange) {
      const cutoffDate = Date.now() - filters.timeRange * 24 * 60 * 60 * 1000;
      filtered = filtered.filter((report) => new Date(report.submittedAt).getTime() > cutoffDate);
    }

    return filtered;
  }, [reports, filters]);

  // Cluster reports (simple implementation)
  const clusteredReports = useMemo(() => {
    if (currentZoom >= CLUSTER_MAX_ZOOM) {
      return filteredReports.map((report) => ({ type: "marker" as const, report }));
    }

    const clusters: Array<
      | { type: "cluster"; reports: Report[]; lat: number; lng: number; count: number }
      | { type: "marker"; report: Report }
    > = [];
    const used = new Set<string>();

    for (const report of filteredReports) {
      if (used.has(report.id)) continue;

      const nearby = [report];
      used.add(report.id);

      for (const other of filteredReports) {
        if (used.has(other.id)) continue;
        if (!other.coordinates || !report.coordinates) continue;

        const distance = Math.sqrt(
          Math.pow(other.coordinates.latitude - report.coordinates.latitude, 2) +
          Math.pow(other.coordinates.longitude - report.coordinates.longitude, 2)
        );

        if (distance < 0.002) { // ~200m at current zoom
          nearby.push(other);
          used.add(other.id);
        }
      }

      if (nearby.length > 1) {
        const avgLat = nearby.reduce((sum, r) => sum + (r.coordinates?.latitude || 0), 0) / nearby.length;
        const avgLng = nearby.reduce((sum, r) => sum + (r.coordinates?.longitude || 0), 0) / nearby.length;
        clusters.push({
          type: "cluster",
          reports: nearby,
          lat: avgLat,
          lng: avgLng,
          count: nearby.length,
        });
      } else {
        clusters.push({ type: "marker", report: nearby[0] });
      }
    }

    return clusters;
  }, [filteredReports, currentZoom]);

  // Get user location
  const getUserLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationMessage("This browser cannot share a location.");
      return;
    }

    setLocationMessage("");
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setUserLocation({ lat: latitude, lng: longitude });
        setIsLocating(false);

        // Pan map to user location
        if (mapRef.current) {
          mapRef.current.setView([latitude, longitude], 15);
        }
      },
      (error) => {
        console.error("Geolocation error:", error);
        setLocationMessage(
          error.code === error.PERMISSION_DENIED
            ? "Location permission is blocked. Allow it in browser settings to show your position."
            : "Your location could not be read. Try again or use the report page to enter an address.",
        );
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, []);

  // Initialize map
  useEffect(() => {
    if (typeof window === "undefined" || !mapContainerRef.current) return;

    // Calculate center from reports if not provided
    const mapCenter = center || (filteredReports.length > 0 && filteredReports[0].coordinates
      ? { lat: filteredReports[0].coordinates.latitude, lng: filteredReports[0].coordinates.longitude }
      : { lat: 40.7128, lng: -74.0060 }); // Default to NYC

    // Create map directly on container ref
    const map = L.map(mapContainerRef.current).setView([mapCenter.lat, mapCenter.lng], zoom);
    mapRef.current = map;

    // Add OpenStreetMap tiles
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    // Track zoom changes
    map.on("zoomend", () => {
      setCurrentZoom(map.getZoom());
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update center when center prop changes
  useEffect(() => {
    if (!mapRef.current) return;
    if (center) {
      mapRef.current.setView([center.lat, center.lng], zoom);
    } else if (filteredReports.length > 0 && filteredReports[0].coordinates) {
      mapRef.current.setView(
        [filteredReports[0].coordinates.latitude, filteredReports[0].coordinates.longitude],
        zoom
      );
    }
  }, [center, zoom, filteredReports]);

  // Update markers when clustered reports change
  useEffect(() => {
    if (!mapRef.current) return;

    const map = mapRef.current;

    // Clear existing markers
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    // Add new markers
    clusteredReports.forEach((item) => {
      if (item.type === "cluster") {
        // Create cluster marker
        const clusterIcon = L.divIcon({
          className: "cluster-marker",
          html: `<div class="cluster-content">${item.count}</div>`,
          iconSize: [40, 40],
          iconAnchor: [20, 20],
        });

        const marker = L.marker([item.lat, item.lng], { icon: clusterIcon }).addTo(map);

        marker.on("click", () => {
          // Zoom in to cluster
          map.setView([item.lat, item.lng], map.getZoom() + 2);
        });

        marker.bindPopup(clusterPopup(item));
        markersRef.current.push(marker);
      } else {
        // Create individual report marker
        const report = item.report;
        const statusColor = STATUS_COLORS[report.status] || "#ff6b6b";
        const isPersistent = report.isPersistentProblem;

        const reportHref = `/reports/${report.id}`;
        const markerIcon = L.divIcon({
          className: "report-marker-icon",
          html: `
            <a class="report-marker-link" href="${reportHref}" target="_blank" rel="noopener noreferrer" aria-label="Open this report in a new tab">
              <div class="report-marker-wrapper ${isPersistent ? 'persistent-problem' : ''}" style="border-color: ${statusColor}">
                ${report.attachments && report.attachments.length > 0
                  ? `<img src="/api/reports/${report.id}/attachments/${report.attachments[0].id}" alt="" class="marker-image" />`
                  : `<div class="marker-placeholder"></div>`
                }
                <div class="marker-status" style="background: ${statusColor}"></div>
                ${isPersistent ? `<div class="persistent-badge">!</div>` : ''}
              </div>
            </a>
          `,
          iconSize: [48, 48],
          iconAnchor: [24, 48],
        });

        const marker = L.marker(
          [report.coordinates!.latitude, report.coordinates!.longitude],
          { icon: markerIcon, keyboard: false, title: "Open report in a new tab" }
        ).addTo(map);

        // Hovering previews the report; clicking its image opens the report tab.
        marker.on("mouseover", () => setHoveredReport(report));
        marker.on("mouseout", () => setHoveredReport(null));

        markersRef.current.push(marker);
      }
    });

    // Add user location marker if available
    if (userLocation && !userLocationMarkerRef.current) {
      const userIcon = L.divIcon({
        className: "user-location-marker",
        html: `<div class="user-location-pulse"></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });

      const userMarker = L.marker([userLocation.lat, userLocation.lng], { icon: userIcon }).addTo(map);
      userLocationMarkerRef.current = userMarker;
    }

    // Cleanup user location marker if location is cleared
    if (!userLocation && userLocationMarkerRef.current) {
      userLocationMarkerRef.current.remove();
      userLocationMarkerRef.current = null;
    }
  }, [clusteredReports, userLocation]);

  return (
    <div className="map-container">
      <div ref={mapContainerRef} style={{ height: "600px", width: "100%" }}></div>

      {/* Map controls */}
      <div className="map-controls">
        <button
          className="map-control-button"
          onClick={getUserLocation}
          disabled={isLocating}
          title="Show my location"
        >
          {isLocating ? "Locating..." : "My Location"}
        </button>
        <button
          className="map-control-button"
          onClick={() => setShowLegend(!showLegend)}
          title="Toggle report status"
        >
          {showLegend ? "Hide Status" : "Show Status"}
        </button>
        <button
          className="map-control-button"
          onClick={() => {
            if (mapRef.current) {
              mapRef.current.invalidateSize();
            }
          }}
          title="Refresh map"
        >
          Refresh
        </button>
      </div>

      {/* Legend */}
      {showLegend && (
        <div className="map-legend">
          <h4>Report Status</h4>
          {Object.entries(STATUS_COLORS).map(([status, color]) => (
            <div key={status} className="legend-item">
              <span className="legend-color" style={{ background: color }}></span>
              <span>{status.replace(/_/g, " ").toLowerCase()}</span>
            </div>
          ))}
          <div className="legend-item">
            <span className="legend-color cluster-legend"></span>
            <span>Clustered reports</span>
          </div>
          <div className="legend-item">
            <span className="legend-color user-legend"></span>
            <span>Your location</span>
          </div>
          <div className="legend-item">
            <span className="legend-color persistent-legend"></span>
            <span>Persistent problem</span>
          </div>
        </div>
      )}

      {locationMessage && (
        <p className="map-location-message" role="status">{locationMessage}</p>
      )}

      {/* Stats panel */}
      <div className="map-stats">
        <h4>Showing {filteredReports.length} report{filteredReports.length !== 1 ? "s" : ""}</h4>
        {filters && (filters.status || filters.category || filters.municipality || filters.timeRange) && (
          <p className="muted">Filters applied</p>
        )}
      </div>

      {/* Hover tooltip */}
      {hoveredReport && (
        <div className="map-tooltip">
          <h4>{hoveredReport.title}</h4>
          <p>{hoveredReport.location}</p>
          <p>Status: <span className="status-badge" style={{ background: STATUS_COLORS[hoveredReport.status] }}>{hoveredReport.status}</span></p>
          {hoveredReport.municipality && <p>Municipality: {hoveredReport.municipality.name}</p>}
        </div>
      )}

    </div>
  );
}
