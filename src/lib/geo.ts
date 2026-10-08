import { Venue } from "../types/venue";

type Coordinate = {
  latitude: number;
  longitude: number;
};

const EARTH_RADIUS_METERS = 6371000;

export function getDistanceMeters(a: Coordinate, b: Coordinate) {
  const latA = toRadians(a.latitude);
  const latB = toRadians(b.latitude);
  const deltaLat = toRadians(b.latitude - a.latitude);
  const deltaLon = toRadians(b.longitude - a.longitude);

  const haversine = Math.sin(deltaLat / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin(deltaLon / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function findClosestVenue(location: Coordinate, venues: Venue[], maxDistanceMeters: number) {
  let closest: { distanceMeters: number; venue: Venue } | null = null;

  for (const venue of venues) {
    const distanceMeters = getDistanceMeters(location, venue);

    if (distanceMeters <= maxDistanceMeters && (!closest || distanceMeters < closest.distanceMeters)) {
      closest = { distanceMeters, venue };
    }
  }

  return closest;
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}
