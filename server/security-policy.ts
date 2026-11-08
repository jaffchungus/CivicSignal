// HTTP response security policy shared by the Express app and the deployment
// configuration. `vercel.json` mirrors these exact values for CDN-served static
// files, and the security-headers test fails if the two drift apart.

export const REFERRER_POLICY = "strict-origin-when-cross-origin";
export const CROSS_ORIGIN_OPENER_POLICY = "same-origin";
export const CROSS_ORIGIN_RESOURCE_POLICY = "same-origin";
export const STRICT_TRANSPORT_SECURITY = "max-age=31536000; includeSubDomains";
// Geolocation stays available to this origin because the map's location button
// uses it; camera, microphone, payment, and USB are denied outright.
export const PERMISSIONS_POLICY =
  "camera=(), microphone=(), payment=(), usb=(), geolocation=(self)";

// The shipped documents have no inline scripts or style blocks, so scripts
// need no nonce and neither scripts nor styles need `unsafe-inline`. React and
// Leaflet set element styles through CSSOM, which CSP does not block. Service
// workers are explicit so `child-src 'none'` can stay strict for frames.
const BASE_DIRECTIVES = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
];

/** Adds HTTPS-only directives when the deployment actually serves HTTPS. */
export function contentSecurityPolicy(production: boolean): string {
  return [...BASE_DIRECTIVES, ...(production ? ["upgrade-insecure-requests"] : [])].join(
    "; ",
  );
}

export const PRODUCTION_CONTENT_SECURITY_POLICY = contentSecurityPolicy(true);
