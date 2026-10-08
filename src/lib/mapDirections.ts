import * as Linking from "expo-linking";
import { Platform } from "react-native";

import { type Venue } from "../types/venue";

type DirectionVenue = Pick<Venue, "latitude" | "longitude" | "name">;

export async function openVenueDirections(venue: DirectionVenue) {
  if (!isValidCoordinate(venue.latitude, venue.longitude)) {
    return { ok: false as const, message: "Directions are unavailable because this venue has invalid coordinates." };
  }

  const destination = `${venue.latitude},${venue.longitude}`;
  const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=walking`;
  const nativeUrl = Platform.OS === "ios"
    ? `http://maps.apple.com/?daddr=${encodeURIComponent(destination)}&dirflg=w`
    : Platform.OS === "android"
      ? `google.navigation:q=${encodeURIComponent(destination)}&mode=w`
      : webUrl;

  try {
    await Linking.openURL(nativeUrl);
    return { ok: true as const, message: `Opened walking directions to ${venue.name}.` };
  } catch {
    if (nativeUrl !== webUrl) {
      try {
        await Linking.openURL(webUrl);
        return { ok: true as const, message: `Opened walking directions to ${venue.name}.` };
      } catch {
        // Fall through to the user-facing error below.
      }
    }

    return { ok: false as const, message: "This device could not open directions." };
  }
}

function isValidCoordinate(latitude: number, longitude: number) {
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}
