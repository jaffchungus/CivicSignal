import { useState, useEffect } from "react";
import type { Report } from "../../shared/contracts";

interface ReportMapProps {
  reports: Report[];
  center?: { lat: number; lng: number };
  zoom?: number;
}

export function ReportMap({ reports, center, zoom = 13 }: ReportMapProps) {
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [hoveredReport, setHoveredReport] = useState<Report | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Load Leaflet CSS and JS dynamically
  useEffect(() => {
    if (typeof window === "undefined") return;

    const loadLeaflet = async () => {
      // Load CSS
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);

      // Load JS
      const script = document.createElement("script");
      script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.async = true;
      script.onload = () => setMapLoaded(true);
      document.body.appendChild(script);
    };

    loadLeaflet();

    return () => {
      // Cleanup would go here in a full implementation
    };
  }, []);

  // Initialize map once Leaflet is loaded
  useEffect(() => {
    if (!mapLoaded || typeof window === "undefined") return;

    // @ts-ignore - Leaflet types not loaded
    const L = window.L;

    // Remove existing map if any
    const existingMap = document.getElementById("report-map");
    if (existingMap && existingMap._leaflet_id) {
      // @ts-ignore
      existingMap._leaflet_map.remove();
    }

    // Calculate center from reports if not provided
    const mapCenter = center || (reports.length > 0 && reports[0].coordinates
      ? { lat: reports[0].coordinates.latitude, lng: reports[0].coordinates.longitude }
      : { lat: 40.7128, lng: -74.0060 }); // Default to NYC

    // Create map
    const map = L.map("report-map").setView([mapCenter.lat, mapCenter.lng], zoom);

    // Add OpenStreetMap tiles
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    // Add markers for reports with coordinates
    const markers: any[] = [];

    reports.forEach((report) => {
      if (!report.coordinates) return;

      // Create custom icon with report image
      const marker = L.marker([report.coordinates.latitude, report.coordinates.longitude], {
        // @ts-ignore
        icon: L.divIcon({
          className: "custom-marker",
          html: `<div class="report-marker" style="background-image: url('/api/reports/${report.id}/attachments/${report.attachments?.[0]?.id}');"></div>`,
          iconSize: [40, 40],
          iconAnchor: [20, 40],
        }),
      });

      // Add popup with report details
      const popupContent = `
        <div class="map-popup">
          <h3>${report.title}</h3>
          <p><strong>Status:</strong> ${report.status}</p>
          <p><strong>Location:</strong> ${report.location}</p>
          <p><strong>Submitted:</strong> ${new Date(report.submittedAt).toLocaleDateString()}</p>
          ${report.reporter ? `<p><strong>Reporter:</strong> ${report.reporter.displayName}</p>` : ""}
          ${report.category ? `<p><strong>Category:</strong> ${report.category.name}</p>` : ""}
          <a href="/reports/${report.id}" target="_blank">View full report</a>
        </div>
      `;

      marker.bindPopup(popupContent);

      // Hover effect
      marker.on("mouseover", () => {
        setHoveredReport(report);
        marker.openPopup();
      });

      marker.on("mouseout", () => {
        setHoveredReport(null);
        marker.closePopup();
      });

      // Click to select
      marker.on("click", () => {
        setSelectedReport(report);
      });

      marker.addTo(map);
      markers.push(marker);
    });

    // Store map instance for cleanup
    // @ts-ignore
    document.getElementById("report-map")._leaflet_map = map;

    return () => {
      map.remove();
    };
  }, [mapLoaded, reports, center, zoom]);

  if (!mapLoaded) {
    return (
      <div className="map-container loading">
        <p>Loading map...</p>
      </div>
    );
  }

  return (
    <div className="map-container">
      <div id="report-map" style={{ height: "500px", width: "100%" }}></div>

      {/* Hover tooltip */}
      {hoveredReport && (
        <div className="map-tooltip">
          <h4>{hoveredReport.title}</h4>
          <p>{hoveredReport.location}</p>
          <p>Status: {hoveredReport.status}</p>
        </div>
      )}

      {/* Selected report details */}
      {selectedReport && (
        <div className="map-details-panel">
          <button
            className="close-button"
            onClick={() => setSelectedReport(null)}
          >
            ×
          </button>
          <h3>{selectedReport.title}</h3>
          {selectedReport.attachments && selectedReport.attachments.length > 0 && (
            <img
              src={`/api/reports/${selectedReport.id}/attachments/${selectedReport.attachments[0].id}`}
              alt={selectedReport.title}
              className="report-image"
            />
          )}
          <p><strong>Description:</strong> {selectedReport.description}</p>
          <p><strong>Location:</strong> {selectedReport.location}</p>
          <p><strong>Status:</strong> {selectedReport.status}</p>
          <p><strong>Submitted:</strong> {new Date(selectedReport.submittedAt).toLocaleString()}</p>
          {selectedReport.reporter && (
            <p><strong>Reporter:</strong> {selectedReport.reporter.displayName}</p>
          )}
          {selectedReport.category && (
            <p><strong>Category:</strong> {selectedReport.category.name}</p>
          )}
          {selectedReport.organization && (
            <p><strong>Organization:</strong> {selectedReport.organization.name}</p>
          )}
          {selectedReport.municipality && (
            <p><strong>Municipality:</strong> {selectedReport.municipality.name}</p>
          )}
          <a href={`/reports/${selectedReport.id}`} className="button primary">
            View full report
          </a>
        </div>
      )}

      <style>{`
        .map-container {
          position: relative;
          border: 1px solid #ddd;
          border-radius: 8px;
          overflow: hidden;
        }

        .map-container.loading {
          height: 500px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #f5f5f5;
        }

        .custom-marker {
          position: relative;
        }

        .report-marker {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background-size: cover;
          background-position: center;
          border: 3px solid #fff;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
          cursor: pointer;
          transition: transform 0.2s;
        }

        .report-marker:hover {
          transform: scale(1.2);
          border-color: #007bff;
        }

        .map-popup {
          min-width: 200px;
        }

        .map-popup h3 {
          margin: 0 0 8px 0;
          font-size: 14px;
        }

        .map-popup p {
          margin: 4px 0;
          font-size: 12px;
        }

        .map-popup a {
          display: inline-block;
          margin-top: 8px;
          color: #007bff;
          text-decoration: none;
        }

        .map-popup a:hover {
          text-decoration: underline;
        }

        .map-tooltip {
          position: absolute;
          bottom: 20px;
          left: 20px;
          background: white;
          padding: 12px;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.2);
          z-index: 1000;
          max-width: 300px;
        }

        .map-tooltip h4 {
          margin: 0 0 8px 0;
        }

        .map-tooltip p {
          margin: 4px 0;
          font-size: 13px;
        }

        .map-details-panel {
          position: absolute;
          top: 20px;
          right: 20px;
          background: white;
          padding: 20px;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.2);
          z-index: 1000;
          max-width: 350px;
          max-height: 80vh;
          overflow-y: auto;
        }

        .map-details-panel .close-button {
          position: absolute;
          top: 10px;
          right: 10px;
          background: none;
          border: none;
          font-size: 24px;
          cursor: pointer;
          padding: 0;
          width: 30px;
          height: 30px;
          line-height: 1;
        }

        .map-details-panel h3 {
          margin: 0 0 16px 0;
          padding-right: 30px;
        }

        .map-details-panel .report-image {
          width: 100%;
          height: auto;
          border-radius: 4px;
          margin-bottom: 12px;
        }

        .map-details-panel p {
          margin: 8px 0;
          font-size: 14px;
        }

        .map-details-panel .button {
          display: inline-block;
          margin-top: 16px;
          padding: 8px 16px;
          text-decoration: none;
          border-radius: 4px;
        }
      `}</style>
    </div>
  );
}
