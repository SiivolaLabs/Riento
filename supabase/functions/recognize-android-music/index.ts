// @ts-nocheck

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";

const maxRequestBytes = 512_000;
const maxFingerprintBytes = 350_000;
const maxProviderResponseBytes = 256_000;
const providerTimeoutMs = 8_000;

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Origin": "*"
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ ok: false, provider: "acrcloud", status: "provider_unavailable", message: "Method not allowed." }, 405);
  }

  const authorization = request.headers.get("Authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!authorization?.startsWith("Bearer ") || !supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ ok: false, provider: "acrcloud", status: "provider_unavailable", message: "A private device session is required." }, 401);
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false }
  });
  const { data: userData, error: userError } = await authClient.auth.getUser();

  if (userError || !userData.user) {
    return jsonResponse({ ok: false, provider: "acrcloud", status: "provider_unavailable", message: "The private device session could not be verified." }, 401);
  }

  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    return jsonResponse({ ok: false, provider: "acrcloud", status: "provider_unavailable", message: "JSON content is required." }, 415);
  }

  const declaredLength = Number(request.headers.get("Content-Length") ?? 0);

  if (Number.isFinite(declaredLength) && declaredLength > maxRequestBytes) {
    return jsonResponse({ ok: false, provider: "acrcloud", status: "provider_unavailable", message: "Fingerprint request is too large." }, 413);
  }

  const body = await readBoundedJson(request, maxRequestBytes);
  const fingerprintBase64 = typeof body?.fingerprintBase64 === "string" ? body.fingerprintBase64 : "";
  const venueId = typeof body?.venueId === "string" ? body.venueId : "";

  if (!isUuid(venueId) || !fingerprintBase64 || fingerprintBase64.length > maxRequestBytes) {
    return jsonResponse({ ok: false, provider: "acrcloud", status: "provider_unavailable", message: "Missing or invalid venue or fingerprint data." }, 400);
  }

  const host = normalizeHost(Deno.env.get("ACRCLOUD_IDENTIFY_HOST"));
  const accessKey = Deno.env.get("ACRCLOUD_ACCESS_KEY")?.trim();
  const accessSecret = Deno.env.get("ACRCLOUD_ACCESS_SECRET")?.trim();

  if (!host || !accessKey || !accessSecret) {
    return jsonResponse({ ok: false, provider: "acrcloud", status: "provider_unavailable", message: "ACRCloud recognition is not configured." }, 503);
  }

  const fingerprintBytes = decodeBase64(fingerprintBase64);

  if (!fingerprintBytes || fingerprintBytes.byteLength === 0 || fingerprintBytes.byteLength > maxFingerprintBytes) {
    return jsonResponse({ ok: false, provider: "acrcloud", status: "provider_unavailable", message: "Invalid fingerprint data." }, 400);
  }

  const { data: attempt, error: attemptError } = await authClient.rpc("claim_music_recognition_attempt", { p_venue_id: venueId });

  if (attemptError || attempt?.ok !== true || !isUuid(attempt?.attempt_id)) {
    return jsonResponse({ ok: false, provider: "acrcloud", status: "provider_unavailable", message: attempt?.message ?? "Music recognition is temporarily limited." }, 429);
  }

  try {
    const acrCloudResult = await identifyFingerprint({ accessKey, accessSecret, fingerprintBytes, host });
    const mappedResult = mapAcrCloudResult(acrCloudResult);

    if (mappedResult.status !== "matched" || !mappedResult.match?.title) {
      return jsonResponse(mappedResult);
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: publication, error: publicationError } = await serviceClient.rpc("publish_provider_music_match", {
      p_artist_name: mappedResult.match.artistName ?? null,
      p_attempt_id: attempt.attempt_id,
      p_confidence: mappedResult.match.confidence ?? 0.75,
      p_track_title: mappedResult.match.title,
      p_user_id: userData.user.id,
      p_venue_id: venueId
    });

    if (publicationError || publication?.ok !== true) {
      return jsonResponse({
        ok: false,
        provider: "acrcloud",
        status: "provider_unavailable",
        message: publication?.message ?? "The provider match could not be published safely."
      }, 502);
    }

    return jsonResponse({ ...mappedResult, published: true });
  } catch (_error) {
    return jsonResponse({ ok: false, provider: "acrcloud", status: "provider_unavailable", message: "ACRCloud recognition failed. No now-playing signal was sent." }, 502);
  }
});

async function identifyFingerprint({ accessKey, accessSecret, fingerprintBytes, host }) {
  const dataType = "fingerprint";
  const endpoint = "/v1/identify";
  const signatureVersion = "1";
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const stringToSign = ["POST", endpoint, accessKey, dataType, signatureVersion, timestamp].join("\n");
  const signature = await hmacSha1Base64(accessSecret, stringToSign);
  const form = new FormData();

  form.set("sample", new Blob([fingerprintBytes], { type: "application/octet-stream" }), "sample.fp");
  form.set("sample_bytes", String(fingerprintBytes.byteLength));
  form.set("access_key", accessKey);
  form.set("data_type", dataType);
  form.set("signature_version", signatureVersion);
  form.set("signature", signature);
  form.set("timestamp", timestamp);

  const response = await fetch(`https://${host}${endpoint}`, {
    method: "POST",
    body: form,
    redirect: "error",
    signal: AbortSignal.timeout(providerTimeoutMs)
  });

  if (!response.ok) {
    throw new Error(`ACRCloud HTTP ${response.status}`);
  }

  const declaredLength = Number(response.headers.get("Content-Length") ?? 0);

  if (Number.isFinite(declaredLength) && declaredLength > maxProviderResponseBytes) {
    throw new Error("ACRCloud response was too large");
  }

  const responseText = await response.text();

  if (responseText.length > maxProviderResponseBytes) {
    throw new Error("ACRCloud response was too large");
  }

  return JSON.parse(responseText);
}

function mapAcrCloudResult(result) {
  const code = Number(result?.status?.code);
  const message = typeof result?.status?.msg === "string" ? result.status.msg : "";
  const track = Array.isArray(result?.metadata?.music) ? result.metadata.music[0] : null;
  const title = typeof track?.title === "string" ? track.title.trim() : "";
  const artistName = Array.isArray(track?.artists) && typeof track.artists[0]?.name === "string" ? track.artists[0].name.trim() : undefined;
  const score = typeof track?.score === "number" ? track.score : undefined;

  if (code === 0 && title && title.length <= 200 && (!artistName || artistName.length <= 200) && (score == null || score >= 60)) {
    return {
      ok: true,
      provider: "acrcloud",
      status: "matched",
      match: {
        title,
        ...(artistName ? { artistName } : {}),
        ...(score != null ? { confidence: score / 100 } : {})
      },
      message: `Matched ${artistName ? `${title} - ${artistName}` : title}. Publishing the venue-level now-playing signal.`
    };
  }

  if (code === 1001 || !track || message.toLowerCase().includes("no result")) {
    return {
      ok: false,
      provider: "acrcloud",
      status: "no_match",
      message: "No ACRCloud match was found. No now-playing signal was sent."
    };
  }

  return {
    ok: false,
    provider: "acrcloud",
    status: "provider_unavailable",
    message: "ACRCloud returned an unavailable recognition result. No now-playing signal was sent."
  };
}

async function hmacSha1Base64(secret, value) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));

  return bytesToBase64(new Uint8Array(signature));
}

function decodeBase64(value) {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
  } catch (_error) {
    return null;
  }
}

function bytesToBase64(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

async function readBoundedJson(request, maxBytes) {
  try {
    if (!request.body) {
      return null;
    }

    const reader = request.body.getReader();
    const chunks = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      totalBytes += value.byteLength;

      if (totalBytes > maxBytes) {
        await reader.cancel();
        return null;
      }

      chunks.push(value);
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;

    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (_error) {
    return null;
  }
}

function normalizeHost(value) {
  if (!value) {
    return "";
  }

  const host = value.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim().toLowerCase();
  return /^[a-z0-9.-]+\.acrcloud\.com$/.test(host) ? host : "";
}

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
