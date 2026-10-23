const COORDINATE_ONLY_LOCATION = /^\s*(?:pinned location:\s*)?-?\d{1,2}(?:\.\d+)?\s*,\s*-?\d{1,3}(?:\.\d+)?\s*$/i;

export function isCoordinateOnlyLocation(location: string): boolean {
  return COORDINATE_ONLY_LOCATION.test(location);
}

export function reportLocationLabel(location: string): string {
  return isCoordinateOnlyLocation(location)
    ? "A street address, intersection, or landmark was not recorded."
    : location;
}
