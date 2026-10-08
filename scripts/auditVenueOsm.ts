import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import OpeningHours from "opening_hours";

import { venueSeedInputs } from "../src/data/venues";
import { venueOsmMetadata, VenueOsmMetadata, VenueOsmMetadataMap } from "../src/data/venueMetadata";
import { VenueWeekday, VenueWeeklyOpeningHours } from "../src/types/venue";

const execFileAsync = promisify(execFile);
const overpassUrl = process.env.OVERPASS_URL ?? "https://z.overpass-api.de/api/interpreter";
const verificationRadiusMeters = 80;
const expectedMatchedCount = 112;
const unresolvedSlugs = new Set(["bubbla-helsinki", "coto-helsinki", "dnd", "night-garden", "sets-backyard"]);
const weekdays: VenueWeekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const verifiedSourceOverrides: Record<string, VenueOsmMetadata["sourceExternalId"]> = {
  "ateljee-bar-hotel-torni": "node/1377211664",
  bardem: "node/7414771954",
  "black-bird": "node/61891088",
  bricco: "node/8874925438",
  "charm-helsinki": "node/13443826824",
  "goldfish-helsinki": "node/6684931019",
  grotesk: "node/600428205",
  "hemingways-itakeskus": "node/61892012",
  "karaoke-nightclub-swengi": "node/648525100",
  "manns-street": "node/8874984242",
  mummotunneli: "node/12000505642",
  "pien-shop-bar": "node/5143651443",
  "pub-sirdie": "node/1589624958",
  "ravintola-oiva": "node/316251306",
  skyroom: "node/5871150865",
  "stadin-panimobaari": "node/3628779222",
  tavastia: "node/1371747508",
  "teerenpeli-helsinki": "node/1371731175",
  tiivistamo: "node/7139485304"
};

type OsmElement = {
  center?: { lat: number; lon: number };
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  type: "node" | "relation" | "way";
};

type OverpassResponse = {
  elements?: OsmElement[];
  osm3s?: { copyright?: string; timestamp_osm_base?: string };
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(scriptDir, "../src/data/venueOsmMetadata.generated.ts");

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const activeSeeds = venueSeedInputs.filter((venue) => venue.verificationStatus !== "closed");
  const response = await fetchOverpass(activeSeeds);
  const elements = response.elements ?? [];
  const elementsByExternalId = new Map(elements.map((element) => [getExternalId(element), element]));
  const checkedAt = new Date().toISOString().slice(0, 10);
  const nextMetadata: VenueOsmMetadataMap = {};
  const unexpectedUnresolved: string[] = [];
  const anomalies: string[] = [];

  for (const venue of activeSeeds) {
    if (unresolvedSlugs.has(venue.id)) {
      const exactCandidate = elements.find((element) => {
        const latitude = getLatitude(element);
        const longitude = getLongitude(element);
        return latitude !== undefined
          && longitude !== undefined
          && distanceMeters(venue.latitude, venue.longitude, latitude, longitude) <= verificationRadiusMeters
          && getElementNames(element).some((name) => normalizeName(name) === normalizeName(venue.name));
      });
      const nearby = getNearbyCandidates(venue.latitude, venue.longitude, elements);
      anomalies.push(`${venue.id}: intentionally unresolved${exactCandidate ? `; exact candidate now requires review: ${getExternalId(exactCandidate)}` : ""}; nearby: ${nearby || "none"}`);
      continue;
    }

    const existingExternalId = venueOsmMetadata[venue.id]?.sourceExternalId;
    const overrideExternalId = verifiedSourceOverrides[venue.id];
    const fixedExternalId = overrideExternalId ?? existingExternalId;
    let match = fixedExternalId ? elementsByExternalId.get(fixedExternalId) : undefined;

    if (match && distanceMeters(venue.latitude, venue.longitude, getLatitude(match), getLongitude(match)) > verificationRadiusMeters) {
      anomalies.push(`${venue.id}: ${fixedExternalId} is farther than ${verificationRadiusMeters} m from the seed`);
      match = undefined;
    }

    if (!match) {
      const exactMatches = elements.filter((element) => {
        const latitude = getLatitude(element);
        const longitude = getLongitude(element);
        const names = getElementNames(element);

        return latitude !== undefined
          && longitude !== undefined
          && distanceMeters(venue.latitude, venue.longitude, latitude, longitude) <= verificationRadiusMeters
          && names.some((name) => normalizeName(name) === normalizeName(venue.name));
      });

      if (exactMatches.length === 1) {
        match = exactMatches[0];
      } else if (exactMatches.length > 1) {
        anomalies.push(`${venue.id}: multiple exact-name OSM candidates (${exactMatches.map(getExternalId).join(", ")})`);
      }
    }

    if (!match) {
      unexpectedUnresolved.push(venue.id);
      const nearby = getNearbyCandidates(venue.latitude, venue.longitude, elements);
      anomalies.push(`${venue.id}: no strong match; nearby: ${nearby || "none"}`);
      continue;
    }

    const sourceExternalId = getExternalId(match);
    const expression = match.tags?.opening_hours?.trim();
    const weekly = expression ? getStableWeeklyHours(expression) : undefined;
    const lifecycleValue = match.tags?.disused ?? match.tags?.abandoned ?? match.tags?.["disused:amenity"] ?? match.tags?.["abandoned:amenity"];

    if (lifecycleValue) {
      unexpectedUnresolved.push(venue.id);
      anomalies.push(`${venue.id}: matched OSM object has a lifecycle marker (${formatValue(lifecycleValue)})`);
      continue;
    }

    if (sourceExternalId !== overrideExternalId && !getElementNames(match).some((name) => normalizeName(name) === normalizeName(venue.name))) {
      unexpectedUnresolved.push(venue.id);
      anomalies.push(`${venue.id}: source name no longer exactly matches (${formatValue(match.tags?.name)})`);
      continue;
    }

    nextMetadata[venue.id] = {
      openingHours: {
        checkedAt,
        ...(expression ? { expression } : {}),
        source: "openstreetmap",
        ...(weekly ? { weekly } : {})
      },
      sourceCheckedAt: checkedAt,
      sourceExternalId
    };

    const current = venueOsmMetadata[venue.id];

    if (current && current.sourceExternalId !== sourceExternalId) {
      anomalies.push(`${venue.id}: source changed from ${current.sourceExternalId} to ${sourceExternalId}`);
    }

    if (current?.openingHours.expression !== expression) {
      anomalies.push(`${venue.id}: opening_hours changed from ${formatValue(current?.openingHours.expression)} to ${formatValue(expression)}`);
    }
  }

  const matchedCount = Object.keys(nextMetadata).length;
  console.log(`OSM snapshot: ${response.osm3s?.timestamp_osm_base ?? "unknown"}`);
  console.log(`Strong OSM metadata matches: ${matchedCount}/${activeSeeds.length}`);
  console.log(`Intentionally unresolved: ${[...unresolvedSlugs].sort().join(", ")}`);

  if (anomalies.length > 0) {
    console.log("Anomalies:");
    anomalies.forEach((anomaly) => console.log(`- ${anomaly}`));
  }

  if (unexpectedUnresolved.length > 0 || matchedCount !== expectedMatchedCount) {
    throw new Error(`Expected ${expectedMatchedCount} strong matches; found ${matchedCount}. Unexpected unresolved: ${unexpectedUnresolved.join(", ") || "none"}.`);
  }

  if (process.argv.includes("--write")) {
    await writeFile(outputPath, renderMetadata(activeSeeds.map((venue) => venue.id), nextMetadata));
    console.log(`Wrote source-match metadata to ${outputPath}`);
    return;
  }

  const staleSlugs = Object.keys(venueOsmMetadata).filter((slug) => !nextMetadata[slug]);
  const changedSlugs = Object.keys(nextMetadata).filter((slug) => !isSameBaseline(venueOsmMetadata[slug], nextMetadata[slug]));

  if (staleSlugs.length > 0 || changedSlugs.length > 0) {
    throw new Error(`Generated metadata is stale. Changed: ${changedSlugs.join(", ") || "none"}. Removed: ${staleSlugs.join(", ") || "none"}. Run npm run audit:venues:osm -- --write after reviewing anomalies.`);
  }

  console.log("Generated OSM metadata matches the current source-match baseline.");
}

async function fetchOverpass(venues: readonly { id: string; latitude: number; longitude: number }[]): Promise<OverpassResponse> {
  const sourceExternalIds = new Set<VenueOsmMetadata["sourceExternalId"]>([
    ...Object.values(venueOsmMetadata).map((metadata) => metadata.sourceExternalId),
    ...Object.values(verifiedSourceOverrides)
  ]);
  const sourceSelectors = [...sourceExternalIds].map((externalId) => `${externalId.replace("/", "(")});`);
  const nearbySelectors = venues
    .filter((venue) => !venueOsmMetadata[venue.id] && !verifiedSourceOverrides[venue.id])
    .map((venue) => `nwr(around:${verificationRadiusMeters},${venue.latitude},${venue.longitude})["name"];`);
  const batches = [...chunk(sourceSelectors, 50), ...chunk(nearbySelectors, 30)];
  const elementsByExternalId = new Map<string, OsmElement>();
  let osm3s: OverpassResponse["osm3s"];

  for (const [index, batch] of batches.entries()) {
    const query = `[out:json][timeout:180];\n(\n${batch.map((selector) => `  ${selector}`).join("\n")}\n);\nout center tags;`;
    const { stdout } = await execFileAsync("curl", [
      "--fail",
      "--silent",
      "--show-error",
      "--retry",
      "6",
      "--retry-all-errors",
      "--retry-delay",
      "10",
      "--max-time",
      "180",
      "--user-agent",
      "MestaVenueAudit/1.0",
      "--get",
      overpassUrl,
      "--data-urlencode",
      `data=${query}`
    ], { maxBuffer: 20 * 1024 * 1024 });
    const response = JSON.parse(stdout) as OverpassResponse;
    osm3s = response.osm3s ?? osm3s;

    for (const element of response.elements ?? []) {
      elementsByExternalId.set(getExternalId(element), element);
    }

    if (index + 1 < batches.length) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10_000));
    }
  }

  return { elements: [...elementsByExternalId.values()], osm3s };
}

function chunk<T>(values: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function renderMetadata(seedOrder: string[], metadata: VenueOsmMetadataMap) {
  const entries = seedOrder.flatMap((slug) => {
    const item = metadata[slug];

    if (!item) {
      return [];
    }

    const openingExpression = item.openingHours.expression
      ? `\n      expression: ${JSON.stringify(item.openingHours.expression)},`
      : "";
    const weekly = item.openingHours.weekly
      ? `\n      weekly: ${JSON.stringify(item.openingHours.weekly)},`
      : "";

    return [`  ${JSON.stringify(slug)}: {\n    openingHours: {\n      checkedAt: ${JSON.stringify(item.openingHours.checkedAt)},${openingExpression}${weekly}\n      source: \"openstreetmap\"\n    },\n    sourceCheckedAt: ${JSON.stringify(item.sourceCheckedAt)},\n    sourceExternalId: ${JSON.stringify(item.sourceExternalId)}\n  }`];
  });

  return `import type { VenueOsmMetadataMap } from "./venueMetadata";\n\n// Generated by npm run audit:venues:osm -- --write. A match verifies source metadata, not operating status.\nexport const venueOsmMetadata = {\n${entries.join(",\n")}\n} satisfies VenueOsmMetadataMap;\n`;
}

function isSameBaseline(current: VenueOsmMetadata | undefined, next: VenueOsmMetadata) {
  return current?.sourceExternalId === next.sourceExternalId
    && current.openingHours.expression === next.openingHours.expression
    && JSON.stringify(current.openingHours.weekly) === JSON.stringify(next.openingHours.weekly);
}

function getStableWeeklyHours(expression: string): VenueWeeklyOpeningHours | undefined {
  try {
    const evaluator = new OpeningHours(expression, {
      address: { country_code: "fi", state: "Uusimaa" },
      lat: 60.1699,
      lon: 24.9384
    });

    if (!evaluator.isWeekStable()) {
      return undefined;
    }

    const weekStart = new Date(2026, 6, 20, 0, 0, 0, 0);
    const weekEnd = new Date(2026, 6, 27, 0, 0, 0, 0);
    const weekly: VenueWeeklyOpeningHours = {};

    for (const [start, end, unknown] of evaluator.getOpenIntervals(weekStart, weekEnd)) {
      if (unknown) {
        return undefined;
      }

      let cursor = new Date(start);

      while (cursor < end) {
        const nextMidnight = new Date(cursor);
        nextMidnight.setHours(24, 0, 0, 0);
        const segmentEnd = end < nextMidnight ? end : nextMidnight;
        const weekday = weekdays[cursor.getDay()];
        const intervals = weekly[weekday] ?? [];
        intervals.push({
          endMinute: segmentEnd.getTime() === nextMidnight.getTime() ? 1440 : segmentEnd.getHours() * 60 + segmentEnd.getMinutes(),
          startMinute: cursor.getHours() * 60 + cursor.getMinutes()
        });
        weekly[weekday] = intervals;
        cursor = new Date(segmentEnd);
      }
    }

    return weekly;
  } catch {
    return undefined;
  }
}

function getElementNames(element: OsmElement) {
  const tags = element.tags ?? {};
  return [tags.name, tags["name:fi"], tags["official_name"], tags.short_name].filter((value): value is string => Boolean(value));
}

function normalizeName(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function getNearbyCandidates(latitude: number, longitude: number, elements: OsmElement[]) {
  return elements
    .flatMap((element) => {
      const candidateLatitude = getLatitude(element);
      const candidateLongitude = getLongitude(element);
      const name = element.tags?.name;

      if (candidateLatitude === undefined || candidateLongitude === undefined || !name) {
        return [];
      }

      const distance = distanceMeters(latitude, longitude, candidateLatitude, candidateLongitude);
      return distance <= verificationRadiusMeters ? [{ distance, element, name }] : [];
    })
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 3)
    .map(({ distance, element, name }) => `${getExternalId(element)} ${JSON.stringify(name)} ${Math.round(distance)}m`)
    .join("; ");
}

function getExternalId(element: OsmElement): VenueOsmMetadata["sourceExternalId"] {
  return `${element.type}/${element.id}`;
}

function getLatitude(element: OsmElement) {
  return element.lat ?? element.center?.lat;
}

function getLongitude(element: OsmElement) {
  return element.lon ?? element.center?.lon;
}

function distanceMeters(leftLatitude: number, leftLongitude: number, rightLatitude: number | undefined, rightLongitude: number | undefined) {
  if (rightLatitude === undefined || rightLongitude === undefined) {
    return Number.POSITIVE_INFINITY;
  }

  const earthRadiusMeters = 6_371_000;
  const latitudeDelta = toRadians(rightLatitude - leftLatitude);
  const longitudeDelta = toRadians(rightLongitude - leftLongitude);
  const leftLatitudeRadians = toRadians(leftLatitude);
  const rightLatitudeRadians = toRadians(rightLatitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(leftLatitudeRadians) * Math.cos(rightLatitudeRadians) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function toRadians(value: number) {
  return value * Math.PI / 180;
}

function formatValue(value: string | undefined) {
  return value ? JSON.stringify(value) : "missing";
}
