import { colors } from "../theme/colors";
import { Venue, VenueOpeningHours, VenueOpenState, VenueSoundTag, VenueWeekday } from "../types/venue";

export type VenueActivityFilter = "any" | "calm" | "lively";

export const venueSoundLabels: Record<VenueSoundTag, string> = {
  "dance-pop": "Dance & pop",
  electronic: "Electronic",
  jazz: "Jazz",
  karaoke: "Karaoke",
  "live-music": "Live music",
  mixed: "Mixed",
  rock: "Rock",
  unknown: "Sound unknown"
};

export const venueOpenStateLabels: Record<VenueOpenState, string> = {
  closed: "Closed now",
  open: "Open now",
  unknown: "Hours unknown"
};

const weekdayByIndex: VenueWeekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const venueTimeFormatters = new Map<string, Intl.DateTimeFormat>();

export function deriveVenueSoundTags(vibe: string): VenueSoundTag[] {
  const normalizedVibe = vibe.toLowerCase();
  const tags: VenueSoundTag[] = [];

  if (normalizedVibe.includes("jazz")) {
    tags.push("jazz");
  }

  if (normalizedVibe.includes("karaoke")) {
    tags.push("karaoke");
  }

  if (normalizedVibe.includes("rock")) {
    tags.push("rock");
  }

  if (normalizedVibe.includes("electronic")) {
    tags.push("electronic");
  }

  if (/live music|live club|live shows|live stage|music venue/.test(normalizedVibe)) {
    tags.push("live-music");
  }

  if (/\bpop\b|mainstream/.test(normalizedVibe)) {
    tags.push("dance-pop");
  }

  const hasGeneralDanceCue = /nightclub|nightlife|party|\bclub\b|\bdjs?\b|music pub|dance floor|disco/.test(normalizedVibe);

  if (tags.length === 0 && hasGeneralDanceCue) {
    tags.push("mixed");
  } else if (tags.includes("live-music") && hasGeneralDanceCue) {
    tags.push("mixed");
  }

  return tags.length > 0 ? tags : ["unknown"];
}

export function getVenueSoundLabels(soundTags: VenueSoundTag[]) {
  return soundTags.map((tag) => venueSoundLabels[tag]);
}

export function matchesVenueSound(venue: Pick<Venue, "soundTags">, soundTag: VenueSoundTag | "any") {
  return soundTag === "any" || venue.soundTags.includes(soundTag);
}

export function matchesVenueActivity(venue: Pick<Venue, "crowdLevel" | "hasLiveCrowdSignal">, activity: VenueActivityFilter) {
  if (activity === "any") {
    return true;
  }

  if (!venue.hasLiveCrowdSignal) {
    return false;
  }

  return activity === "calm" ? venue.crowdLevel === "quiet" : venue.crowdLevel !== "quiet";
}

export function evaluateVenueOpenState(openingHours: VenueOpeningHours | undefined, now = new Date(), timeZone = "Europe/Helsinki"): VenueOpenState {
  const expression = openingHours?.expression?.trim();

  if (!expression || !openingHours?.weekly) {
    return "unknown";
  }

  const checkedAt = new Date(`${openingHours?.checkedAt ?? ""}T00:00:00Z`);

  if (!Number.isFinite(checkedAt.getTime()) || now.getTime() - checkedAt.getTime() > 366 * 24 * 60 * 60 * 1000) {
    return "unknown";
  }

  const venueTime = getTimeInTimeZone(now, timeZone);

  if (!venueTime) {
    return "unknown";
  }

  const intervals = openingHours.weekly[venueTime.weekday] ?? [];
  return intervals.some((interval) => venueTime.minute >= interval.startMinute && venueTime.minute < interval.endMinute) ? "open" : "closed";
}

export function getVenueOpenStateLabel(openingHours: VenueOpeningHours | undefined, now = new Date(), timeZone = "Europe/Helsinki") {
  return venueOpenStateLabels[evaluateVenueOpenState(openingHours, now, timeZone)];
}

export function getVenueOpenStatePriority(openingHours: VenueOpeningHours | undefined, now = new Date(), timeZone = "Europe/Helsinki") {
  switch (evaluateVenueOpenState(openingHours, now, timeZone)) {
    case "open":
      return 0;
    case "unknown":
      return 1;
    case "closed":
      return 2;
  }
}

export function formatVenueDistance(distanceMeters: number) {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    return undefined;
  }

  if (distanceMeters < 1000) {
    if (distanceMeters < 25) {
      return "Nearby";
    }

    const roundedMeters = Math.max(50, Math.round(distanceMeters / 50) * 50);
    return roundedMeters >= 1000 ? "1.0 km" : `${roundedMeters} m`;
  }

  const distanceKilometers = distanceMeters / 1000;
  return `${distanceKilometers < 10 ? distanceKilometers.toFixed(1) : Math.round(distanceKilometers)} km`;
}

export function getVenueVibeColor(venue: Pick<Venue, "kind" | "soundTags">) {
  const primaryTag = venue.soundTags.find((tag) => tag !== "unknown");

  switch (primaryTag) {
    case "dance-pop":
    case "karaoke":
      return colors.rose;
    case "electronic":
      return colors.violet;
    case "jazz":
    case "live-music":
      return colors.amber;
    case "rock":
      return colors.warning;
    case "mixed":
      return colors.cyan;
    default:
      return venue.kind === "club" ? colors.accent : colors.muted;
  }
}

function getTimeInTimeZone(now: Date, timeZone: string) {
  try {
    let formatter = venueTimeFormatters.get(timeZone);

    if (!formatter) {
      formatter = new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        hourCycle: "h23",
        minute: "2-digit",
        timeZone,
        weekday: "short"
      });
      venueTimeFormatters.set(timeZone, formatter);
    }

    const parts = formatter.formatToParts(now);
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    const weekdayText = parts.find((part) => part.type === "weekday")?.value.toLowerCase().slice(0, 3);
    const weekdayIndex = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(weekdayText ?? "");

    if (!Number.isInteger(hour) || !Number.isInteger(minute) || weekdayIndex < 0) {
      return null;
    }

    return { minute: hour * 60 + minute, weekday: weekdayByIndex[weekdayIndex] };
  } catch {
    return null;
  }
}
