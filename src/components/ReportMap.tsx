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
const PERSISTENT_COLOR = "#a3312c";

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

      <style>{`
        .map-container {
          position: relative;
          border: 1px solid #e1e4e8;
          border-radius: 8px;
          overflow: hidden;
          box-shadow: 0 1px 3px rgba(0,0,0,0.08);
        }

        .map-container.loading {
          height: 600px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: #f6f8fa;
          gap: 16px;
        }

        .loading-spinner {
          width: 40px;
          height: 40px;
          border: 4px solid #e1e4e8;
          border-top-color: #0969da;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .map-controls {
          position: absolute;
          top: 10px;
          right: 10px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          z-index: 1000;
        }

        .map-control-button {
          min-height: 44px;
          background: #fff;
          border: 1px solid #cbd7d0;
          border-radius: 6px;
          padding: 8px 16px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 650;
          color: #292d28;
          box-shadow: 0 1px 3px rgba(35,38,31,0.08);
          transition: border-color 120ms ease, background-color 120ms ease;
          white-space: nowrap;
        }

        .map-location-message {
          position: absolute;
          top: 10px;
          left: 10px;
          max-width: min(320px, calc(100% - 150px));
          margin: 0;
          padding: 8px 12px;
          border: 1px solid #dfc58f;
          border-radius: 6px;
          background: #fbf1dc;
          color: #553b12;
          font-size: 13px;
          z-index: 1000;
        }

        .map-control-button:hover:not(:disabled) {
          background: #f1f6f2;
          border-color: #416b58;
          box-shadow: 0 1px 3px rgba(35,38,31,0.12);
        }

        .map-control-button:active:not(:disabled) {
          background: #f0f2f5;
          transform: translateY(0);
        }

        .map-control-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .map-legend {
          position: absolute;
          bottom: 20px;
          left: 20px;
          background: white;
          padding: 16px;
          border-radius: 8px;
          border: 1px solid #e1e4e8;
          box-shadow: 0 2px 8px rgba(0,0,0,0.12);
          z-index: 1000;
          max-width: 220px;
        }

        .map-legend h4 {
          margin: 0 0 12px 0;
          font-size: 14px;
          font-weight: 600;
          color: #24292f;
        }

        .legend-item {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 8px 0;
          font-size: 13px;
          color: #24292f;
        }

        .legend-color {
          width: 16px;
          height: 16px;
          border-radius: 4px;
          flex-shrink: 0;
        }

        .legend-color.cluster-legend {
          background: #666;
          border-radius: 50%;
        }

        .legend-color.user-legend {
          background: #0969da;
          border-radius: 50%;
        }

        .legend-color.persistent-legend {
          background: ${PERSISTENT_COLOR};
          border-radius: 50%;
        }

        .map-stats {
          position: absolute;
          bottom: 20px;
          right: 20px;
          background: white;
          padding: 12px 16px;
          border-radius: 8px;
          border: 1px solid #e1e4e8;
          box-shadow: 0 2px 8px rgba(0,0,0,0.12);
          z-index: 1000;
        }

        .map-stats h4 {
          margin: 0 0 4px 0;
          font-size: 14px;
          font-weight: 600;
          color: #24292f;
        }

        .map-stats .muted {
          margin: 0;
          font-size: 12px;
          color: #57606a;
        }

        .report-marker-icon {
          background: transparent;
        }

        .report-marker-link {
          display: block;
          width: 48px;
          height: 48px;
          border-radius: 50%;
          text-decoration: none;
        }

        .report-marker-link:focus-visible {
          outline: 3px solid #1f4d3a;
          outline-offset: 3px;
        }

        .report-marker-wrapper {
          position: relative;
          width: 48px;
          height: 48px;
          border-radius: 50%;
          border: 3px solid;
          overflow: hidden;
          background: white;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
          transition: transform 0.2s, box-shadow 0.2s;
        }

        .report-marker-wrapper:hover {
          transform: scale(1.15);
          box-shadow: 0 4px 12px rgba(0,0,0,0.4);
        }

        .report-marker-wrapper.persistent-problem {
          animation: pulse-border 2s infinite;
        }

        @keyframes pulse-border {
          0%, 100% {
            box-shadow: 0 0 0 0 rgba(255, 71, 87, 0.7);
          }
          50% {
            box-shadow: 0 0 0 8px rgba(255, 71, 87, 0);
          }
        }

        .persistent-badge {
          position: absolute;
          top: -4px;
          right: -4px;
          width: 20px;
          height: 20px;
          background: ${PERSISTENT_COLOR};
          color: white;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          font-weight: 700;
          border: 2px solid white;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }

        .marker-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .marker-placeholder {
          width: 100%;
          height: 100%;
          background: #e1e4e8;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .marker-placeholder::before {
          content: "";
          width: 20px;
          height: 20px;
          background: #8b949e;
          border-radius: 50%;
        }

        .marker-status {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 8px;
        }

        .cluster-marker {
          background: transparent;
        }

        .cluster-content {
          width: 40px;
          height: 40px;
          background: #24292f;
          color: white;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 600;
          font-size: 14px;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
          cursor: pointer;
          transition: transform 0.2s;
        }

        .cluster-content:hover {
          transform: scale(1.1);
        }

        .user-location-marker {
          background: transparent;
        }

        .user-location-pulse {
          width: 20px;
          height: 20px;
          background: #0969da;
          border-radius: 50%;
          box-shadow: 0 0 0 0 rgba(9, 105, 218, 0.7);
          animation: pulse 2s infinite;
        }

        @keyframes pulse {
          0% {
            transform: scale(0.95);
            box-shadow: 0 0 0 0 rgba(0, 123, 255, 0.7);
          }
          70% {
            transform: scale(1);
            box-shadow: 0 0 0 10px rgba(0, 123, 255, 0);
          }
          100% {
            transform: scale(0.95);
            box-shadow: 0 0 0 0 rgba(0, 123, 255, 0);
          }
        }

        .map-popup {
          min-width: 240px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }

        .map-popup.cluster-popup {
          min-width: 200px;
        }

        .map-popup h3 {
          margin: 0 0 10px 0;
          font-size: 14px;
          font-weight: 600;
          color: #24292f;
        }

        .map-popup p {
          margin: 6px 0;
          font-size: 12px;
          color: #57606a;
          line-height: 1.5;
        }

        .map-popup .status-dot {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          margin-right: 6px;
        }

        .map-popup .status-badge {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 12px;
          color: white;
          font-size: 11px;
          font-weight: 500;
        }

        .map-popup .view-link {
          display: inline-block;
          margin-top: 10px;
          color: #0969da;
          text-decoration: none;
          font-size: 12px;
          font-weight: 500;
        }

        .map-popup .view-link:hover {
          text-decoration: underline;
        }

        .map-popup .muted {
          color: #8b949e;
          font-style: italic;
        }

        .map-popup .persistent-warning {
          background: #fff8c5;
          border-left: 3px solid #d29922;
          padding: 8px 12px;
          margin: 8px 0;
          font-size: 12px;
          color: #6f4e37;
        }

        .map-tooltip {
          position: absolute;
          bottom: 80px;
          left: 20px;
          background: white;
          padding: 12px 16px;
          border-radius: 8px;
          border: 1px solid #e1e4e8;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          z-index: 1000;
          max-width: 300px;
          animation: slideUp 0.2s ease-out;
        }

        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .map-tooltip h4 {
          margin: 0 0 8px 0;
          font-size: 14px;
          font-weight: 600;
          color: #24292f;
        }

        .map-tooltip p {
          margin: 4px 0;
          font-size: 13px;
          color: #57606a;
        }

        .map-tooltip .status-badge {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 12px;
          color: white;
          font-size: 11px;
          font-weight: 500;
        }

        .map-details-panel {
          position: absolute;
          top: 10px;
          left: 10px;
          right: 60px;
          background: white;
          padding: 20px;
          border-radius: 8px;
          border: 1px solid #e1e4e8;
          box-shadow: 0 4px 16px rgba(0,0,0,0.15);
          z-index: 1000;
          max-width: 400px;
          max-height: 85vh;
          overflow-y: auto;
          animation: slideIn 0.3s ease-out;
        }

        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateX(-10px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        .map-details-panel .close-button {
          position: absolute;
          top: 12px;
          right: 12px;
          background: none;
          border: none;
          font-size: 24px;
          cursor: pointer;
          padding: 0;
          width: 32px;
          height: 32px;
          line-height: 1;
          color: #8b949e;
          transition: color 0.2s;
        }

        .map-details-panel .close-button:hover {
          color: #24292f;
        }

        .map-details-panel h3 {
          margin: 0 0 16px 0;
          padding-right: 36px;
          font-size: 18px;
          font-weight: 600;
          color: #24292f;
        }

        .map-details-panel .report-image {
          width: 100%;
          height: auto;
          border-radius: 8px;
          margin-bottom: 16px;
          object-fit: cover;
          border: 1px solid #e1e4e8;
        }

        .map-details-panel .report-meta {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .map-details-panel .report-meta p {
          margin: 0;
          font-size: 14px;
          color: #57606a;
          line-height: 1.5;
        }

        .map-details-panel .persistent-problem-alert {
          background: #fff8c5;
          border: 1px solid #d29922;
          border-radius: 6px;
          padding: 12px;
          margin-bottom: 12px;
        }

        .map-details-panel .persistent-problem-alert strong {
          display: block;
          color: #6f4e37;
          margin-bottom: 4px;
          font-weight: 600;
        }

        .map-details-panel .persistent-problem-alert .muted {
          margin: 0;
          font-size: 13px;
          color: #6f4e37;
        }

        .map-details-panel .report-meta strong {
          color: #24292f;
          font-weight: 600;
        }

        .map-details-panel .status-badge {
          display: inline-block;
          padding: 3px 10px;
          border-radius: 12px;
          color: white;
          font-size: 12px;
          font-weight: 500;
        }

        .map-details-panel .button {
          display: inline-block;
          margin-top: 16px;
          padding: 10px 20px;
          text-decoration: none;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 500;
        }

        .map-details-panel .button.primary {
          background: #0969da;
          color: white;
          border-color: #0969da;
        }

        .map-details-panel .button.primary:hover {
          background: #0860ca;
          border-color: #0860ca;
        }

        .map-details-panel .button.primary:hover {
          background: #0056b3;
        }
      `}</style>
    </div>
  );
}
