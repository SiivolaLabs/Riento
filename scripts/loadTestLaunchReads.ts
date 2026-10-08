const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const concurrency = getIntegerArg("--concurrency", 100, 1, 2_000);
const confirmProduction = process.argv.includes("--confirm-production-read-load");
const endpointNames = ["venues", "enrichments"] as const;
type EndpointName = typeof endpointNames[number];

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  if (!supabaseUrl || !anonKey) {
    throw new Error("Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY for the staging project.");
  }

  if (supabaseUrl.includes("adytflvtwkizparpoazu") && !confirmProduction) {
    throw new Error("Production read load requires --confirm-production-read-load and operator approval. Use staging by default.");
  }

  const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" };
  const results = await Promise.all(Array.from({ length: concurrency }, async () => {
    const startedAt = performance.now();
    const venueResult = await measureRequest("venues",
      `${supabaseUrl}/rest/v1/venues?select=id,slug,name,kind,address,neighborhood,latitude,longitude,capacity_estimate,source,source_external_id,source_checked_at,verification_status,opening_hours,vibe,sound_tags&verification_status=in.(needs_verification,verified)&order=name`,
      { headers }
    );
    const enrichmentResult = await measureRequest("enrichments",
      `${supabaseUrl}/rest/v1/public_venue_enrichment_cache?select=payload&limit=1`,
      { headers }
    );

    return {
      durationMs: performance.now() - startedAt,
      endpoints: [venueResult, enrichmentResult],
      ok: venueResult.ok && enrichmentResult.ok
    };
  }));

  const durations = results.map((result) => result.durationMs).sort((left, right) => left - right);
  const failures = results.filter((result) => !result.ok).length;
  const p50 = percentile(durations, 0.5);
  const p95 = percentile(durations, 0.95);
  const p99 = percentile(durations, 0.99);

  console.log(`Cold-open read burst: ${concurrency} clients, ${concurrency * 2} requests, ${failures} failed.`);
  console.log(`Bundle latency: p50 ${p50}ms, p95 ${p95}ms, p99 ${p99}ms.`);

  for (const endpointName of endpointNames) {
    const endpointResults = results.flatMap((result) => result.endpoints.filter((endpoint) => endpoint.name === endpointName));
    const endpointDurations = endpointResults.map((result) => result.durationMs).sort((left, right) => left - right);
    const endpointFailures = endpointResults.filter((result) => !result.ok).length;
    const networkFailures = endpointResults.filter((result) => result.status === 0).length;
    console.log(`${endpointName}: p50 ${percentile(endpointDurations, 0.5)}ms, p95 ${percentile(endpointDurations, 0.95)}ms, p99 ${percentile(endpointDurations, 0.99)}ms, ${endpointFailures} failed (${networkFailures} network).`);
  }

  if (failures > 0 || p95 > 3_000) {
    throw new Error("Read burst exceeded the launch gate: zero failures and p95 below 3000ms are required.");
  }
}

async function measureRequest(name: EndpointName, url: string, init: RequestInit) {
  const startedAt = performance.now();

  try {
    const response = await fetch(url, init);
    await response.arrayBuffer();

    return {
      durationMs: performance.now() - startedAt,
      name,
      ok: response.ok,
      status: response.status
    };
  } catch {
    return {
      durationMs: performance.now() - startedAt,
      name,
      ok: false,
      status: 0
    };
  }
}

function getIntegerArg(name: string, fallback: number, minimum: number, maximum: number) {
  const index = process.argv.indexOf(name);
  const parsed = index >= 0 ? Number(process.argv[index + 1]) : fallback;

  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }

  return parsed;
}

function percentile(sortedValues: number[], percentileValue: number) {
  const index = Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * percentileValue) - 1);
  return Math.round(sortedValues[index]);
}
