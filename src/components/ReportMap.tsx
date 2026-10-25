import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Report } from "../../shared/contracts";

// Fix for default marker icons in Leaflet with React
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

interface ReportMapProps {
  reports: Report[];
  onReportClick?: (report: Report) => void;
  center?: [number, number];
  zoom?: number;
  height?: string;
}

export function ReportMap({
  reports,
  onReportClick,
  center = [40.7128, -74.0060], // Default to NYC
  zoom = 13,
  height = "500px",
}: ReportMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Initialize map
    const map = L.map(mapContainerRef.current).setView(center, zoom);

    // Add OpenStreetMap tiles
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [center, zoom]);

  useEffect(() => {
    if (!mapRef.current) return;

    // Clear existing markers
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    // Add markers for reports with coordinates
    reports.forEach((report) => {
      if (!report.coordinates) return;

      const { latitude, longitude } = report.coordinates;

      // Create custom icon with report image if available
      let icon = L.divIcon({
        className: "custom-marker",
        html: `<div class="marker-pin" style="background-color: ${getStatusColor(report.status)}"></div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 30],
      });

      const marker = L.marker([latitude, longitude], { icon }).addTo(mapRef.current!);

      // Add click handler
      marker.on("click", () => {
        setSelectedReport(report);
        onReportClick?.(report);
      });

      // Add popup with report info
      const popupContent = `
        <div class="report-popup">
          <strong>${report.title}</strong>
          <p>${report.category.name}</p>
          <p>Status: ${report.status}</p>
          <p>Submitted: ${new Date(report.submittedAt).toLocaleDateString()}</p>
          ${report.attachments && report.attachments.length > 0
            ? `<img src="${report.attachments[0].url}" alt="Report photo" style="max-width: 200px; border-radius: 4px;" />`
            : ""
          }
        </div>
      `;
      marker.bindPopup(popupContent);

      markersRef.current.push(marker);
    });

    // Fit map to show all markers if there are any
    if (markersRef.current.length > 0) {
      const group = L.featureGroup(markersRef.current);
      mapRef.current.fitBounds(group.getBounds().pad(0.1));
    }
  }, [reports, onReportClick]);

  function getStatusColor(status: string): string {
    switch (status) {
      case "SUBMITTED":
        return "#3b82f6"; // blue
      case "UNDER_REVIEW":
        return "#f59e0b"; // amber
      case "IN_PROGRESS":
        return "#8b5cf6"; // purple
      case "RESOLVED":
        return "#10b981"; // green
      case "CLOSED":
        return "#6b7280"; // gray
      default:
        return "#ef4444"; // red
    }
  }

  return (
    <div>
      <div ref={mapContainerRef} style={{ height, width: "100%", borderRadius: "8px" }} />
      {selectedReport && (
        <div className="map-report-details">
          <h3>{selectedReport.title}</h3>
          <p><strong>Category:</strong> {selectedReport.category.name}</p>
          <p><strong>Status:</strong> {selectedReport.status}</p>
          <p><strong>Location:</strong> {selectedReport.location}</p>
          <p><strong>Submitted by:</strong> {selectedReport.reporter?.displayName || "Guest"}</p>
          <p><strong>Submitted:</strong> {new Date(selectedReport.submittedAt).toLocaleString()}</p>
          {selectedReport.municipalityName && (
            <p><strong>Municipality:</strong> {selectedReport.municipalityName}</p>
          )}
          {selectedReport.attachments && selectedReport.attachments.length > 0 && (
            <img
              src={selectedReport.attachments[0].url}
              alt="Report photo"
              style={{ maxWidth: "100%", borderRadius: "8px", marginTop: "12px" }}
            />
          )}
          <button
            onClick={() => setSelectedReport(null)}
            style={{ marginTop: "12px", padding: "8px 16px" }}
          >
            Close
          </button>
        </div>
      )}
      <style>{`
        .custom-marker {
          background: transparent;
        }
        .marker-pin {
          width: 30px;
          height: 30px;
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          border: 2px solid white;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        .report-popup {
          font-family: system-ui, sans-serif;
          min-width: 200px;
        }
        .report-popup img {
          margin-top: 8px;
          border-radius: 4px;
        }
        .map-report-details {
          position: absolute;
          top: 10px;
          right: 10px;
          background: white;
          padding: 16px;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.2);
          max-width: 300px;
          z-index: 1000;
        }
        .map-report-details h3 {
          margin: 0 0 12px 0;
        }
        .map-report-details p {
          margin: 8px 0;
        }
      `}</style>
    </div>
  );
}
