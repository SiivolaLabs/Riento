// @ts-nocheck

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Origin": "*"
};
const maxRequestBytes = 16_384;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ ok: false, message: "Method not allowed." }, 405);
  }

  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    return jsonResponse({ ok: false, message: "JSON content is required." }, 415);
  }

  const declaredLength = Number(request.headers.get("Content-Length") ?? 0);

  if (Number.isFinite(declaredLength) && declaredLength > maxRequestBytes) {
    return jsonResponse({ ok: false, message: "Deletion request is too large." }, 413);
  }

  let payload: {
    appleAuthorizationCode?: string;
    appleNonce?: string;
    confirmation?: string;
    expectedProviderSubjects?: string[];
    expectedUserId?: string;
    operationToken?: string;
    requireAnonymous?: boolean;
  };

  try {
    payload = await readBoundedJson(request, maxRequestBytes);
  } catch {
    return jsonResponse({ ok: false, message: "Invalid request body." }, 400);
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return jsonResponse({ ok: false, message: "Invalid request body." }, 400);
  }

  if (payload.confirmation !== "DELETE_DEVICE_DATA") {
    return jsonResponse({ ok: false, message: "Deletion confirmation is required." }, 400);
  }

  if (payload.operationToken !== undefined
    && (typeof payload.operationToken !== "string" || !/^[0-9a-f]{64}$/.test(payload.operationToken))) {
    return jsonResponse({ ok: false, message: "A valid deletion recovery token is required." }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ ok: false, message: "Deletion service is not configured." }, 500);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  let operationTokenHash = payload.operationToken ? await sha256Hex(payload.operationToken) : null;
  let operation = operationTokenHash
    ? await loadDeletionOperation(adminClient, operationTokenHash)
    : null;

  if (!operation) {
    const authorization = request.headers.get("Authorization");
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;

    if (!token) {
      return jsonResponse({ ok: false, message: "The deletion request could not be authorized." }, 401);
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false }
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);

    if (authError || !authData.user) {
      return jsonResponse({ ok: false, message: "The deletion request could not be authorized." }, 401);
    }

    if (typeof payload.expectedUserId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.expectedUserId)) {
      return jsonResponse({ ok: false, message: "A valid expected identity is required." }, 400);
    }

    if (authData.user.id !== payload.expectedUserId) {
      return jsonResponse({ ok: false, message: "The signed-in identity changed after deletion was confirmed." }, 409);
    }

    if (typeof payload.requireAnonymous !== "boolean" || authData.user.is_anonymous !== payload.requireAnonymous) {
      return jsonResponse({ ok: false, message: "The signed-in account type changed after deletion was confirmed." }, 409);
    }

    if (!Array.isArray(payload.expectedProviderSubjects)
      || payload.expectedProviderSubjects.length > 16
      || payload.expectedProviderSubjects.some((value) => typeof value !== "string" || value.length > 512)) {
      return jsonResponse({ ok: false, message: "A valid account identity fingerprint is required." }, 400);
    }

    const expectedProviderSubjects = [...payload.expectedProviderSubjects].sort();
    const actualProviderSubjects = (authData.user.identities ?? [])
      .map((identity) => `${identity.provider}:${identity.identity_data?.sub ?? identity.id}`)
      .sort();

    if (expectedProviderSubjects.length !== actualProviderSubjects.length
      || expectedProviderSubjects.some((value, index) => value !== actualProviderSubjects[index])) {
      return jsonResponse({ ok: false, message: "The account identities changed after deletion was confirmed." }, 409);
    }

    const appleIdentity = authData.user.identities?.find((identity) => identity.provider === "apple");

    if (!operationTokenHash) {
      operation = await loadProcessingDeletionOperationForUser(adminClient, authData.user.id);

      if (operation) {
        return continueDeletion(adminClient, operation, payload.appleAuthorizationCode, payload.appleNonce);
      }

      operationTokenHash = await sha256Hex(createRandomOperationToken());
    }

    const { data: insertedOperation, error: insertError } = await adminClient
      .from("identity_deletion_operations")
      .insert({
        apple_subject: appleIdentity?.identity_data?.sub ?? appleIdentity?.id ?? null,
        google_revocation_required: authData.user.identities?.some((identity) => identity.provider === "google") ?? false,
        operation_token_hash: operationTokenHash,
        provider_revocation_status: appleIdentity ? "pending" : "not_needed",
        status: "processing",
        target_user_id: authData.user.id
      })
      .select(deletionOperationColumns)
      .single();

    if (insertError || !insertedOperation) {
      operation = await loadDeletionOperation(adminClient, operationTokenHash);

      if (!operation) {
        return jsonResponse({ ok: false, message: "Could not prepare recoverable deletion." }, 500);
      }
    } else {
      operation = insertedOperation;
    }
  }

  return continueDeletion(adminClient, operation, payload.appleAuthorizationCode, payload.appleNonce);
});

async function readBoundedJson(request, maxBytes) {
  if (!request.body) {
    throw new Error("Missing request body");
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
      throw new Error("Request body too large");
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
}

const deletionOperationColumns = "id,target_user_id,status,data_deleted_at,auth_deleted_at,completed_at,provider_revocation_status,provider_revocation_started_at,apple_subject,google_revocation_required";

async function loadDeletionOperation(adminClient: any, operationTokenHash: string) {
  const { data, error } = await adminClient
    .from("identity_deletion_operations")
    .select(deletionOperationColumns)
    .eq("operation_token_hash", operationTokenHash)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function loadProcessingDeletionOperationForUser(adminClient: any, userId: string) {
  const { data, error } = await adminClient
    .from("identity_deletion_operations")
    .select(deletionOperationColumns)
    .eq("target_user_id", userId)
    .eq("status", "processing")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function continueDeletion(
  adminClient: any,
  operation: any,
  appleAuthorizationCode: unknown,
  appleNonce: unknown
) {
  if (operation.status === "completed" && operation.data_deleted_at && operation.auth_deleted_at) {
    return completeDeletionOperation(adminClient, operation);
  }

  const userId = operation.target_user_id;

  if (!operation.data_deleted_at) {
    const { data, error } = await adminClient.rpc("delete_identity_data", { p_user_id: userId });

    if (error || data?.ok !== true) {
      await recordDeletionError(adminClient, operation.id, "identity_data_delete_failed");
      return processingResponse("Riento data deletion is still processing. Retry shortly.", false, false);
    }

    const { data: updatedOperation, error: updateError } = await adminClient
      .from("identity_deletion_operations")
      .update({ data_deleted_at: new Date().toISOString(), last_error_code: null })
      .eq("id", operation.id)
      .select(deletionOperationColumns)
      .single();

    if (updateError || !updatedOperation) {
      return processingResponse("Riento data deletion is still processing. Retry shortly.", true, false);
    }

    operation = updatedOperation;
  }

  const revocationResult = await continueAppleRevocation(
    adminClient,
    operation,
    appleAuthorizationCode,
    appleNonce
  );

  if (!revocationResult.ok) {
    return processingResponse(revocationResult.message, true, Boolean(operation.auth_deleted_at));
  }

  operation = revocationResult.operation;

  if (!operation.auth_deleted_at) {
    const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(userId, false);
    let authDeleted = !deleteUserError;

    if (deleteUserError) {
      const { data: lookupData, error: lookupError } = await adminClient.auth.admin.getUserById(userId);

      if (!lookupError && lookupData.user) {
        await recordDeletionError(adminClient, operation.id, "auth_user_delete_failed");
        return processingResponse("The account deletion is still processing. Retry shortly.", true, false);
      }

      if (lookupError?.status === 404 || lookupError?.code === "user_not_found") {
        authDeleted = true;
      } else {
        await recordDeletionError(adminClient, operation.id, "auth_user_status_unknown");
        return processingResponse("The account deletion status is still being verified. Retry shortly.", true, false);
      }
    }

    if (authDeleted) {
      const { data: updatedOperation, error: updateError } = await adminClient
        .from("identity_deletion_operations")
        .update({ auth_deleted_at: new Date().toISOString(), last_error_code: null })
        .eq("id", operation.id)
        .select(deletionOperationColumns)
        .single();

      if (updateError || !updatedOperation) {
        return processingResponse("The account was deleted, but completion is still being recorded. Retry shortly.", true, true);
      }

      operation = updatedOperation;
    }
  }

  return completeDeletionOperation(adminClient, operation);
}

async function completeDeletionOperation(adminClient: any, operation: any) {
  const providerRevocation = isProviderRevocation(operation.provider_revocation_status)
    ? operation.provider_revocation_status
    : "failed";
  const { data: completedOperation, error: completionError } = await adminClient
    .from("identity_deletion_operations")
    .update({
      apple_subject: null,
      completed_at: operation.completed_at ?? new Date().toISOString(),
      last_error_code: null,
      provider_revocation_started_at: null,
      provider_revocation_status: providerRevocation,
      status: "completed",
      target_user_id: null
    })
    .eq("id", operation.id)
    .select("google_revocation_required")
    .single();

  if (completionError) {
    return processingResponse("The account was deleted, but completion is still being recorded. Retry shortly.", true, true);
  }

  const { error: refreshError } = await adminClient.rpc("refresh_crowd_snapshots", { p_window_minutes: 90 });

  return jsonResponse({
    authDeleted: true,
    dataDeleted: true,
    googleRevocationRequired: completedOperation?.google_revocation_required === true,
    message: refreshError
      ? "Data was deleted. Crowd labels will reconcile on the next scheduled refresh."
      : "Riento data deleted.",
    ok: true,
    providerRevocation,
    state: "completed"
  });
}

async function continueAppleRevocation(
  adminClient: any,
  operation: any,
  appleAuthorizationCode: unknown,
  appleNonce: unknown
) {
  if (operation.provider_revocation_status === "pending") {
    const startedAt = new Date().toISOString();
    const { data: claimedOperation, error: claimError } = await adminClient
      .from("identity_deletion_operations")
      .update({ provider_revocation_started_at: startedAt, provider_revocation_status: "attempting" })
      .eq("id", operation.id)
      .eq("provider_revocation_status", "pending")
      .select(deletionOperationColumns)
      .maybeSingle();

    if (claimError) {
      return { ok: false, message: "Provider cleanup is still being prepared. Retry shortly.", operation };
    }

    if (claimedOperation) {
      const providerRevocationStatus = await revokeAppleAuthorization(
        appleAuthorizationCode,
        appleNonce,
        claimedOperation.apple_subject
      );
      const { data: updatedOperation, error: updateError } = await adminClient
        .from("identity_deletion_operations")
        .update({ provider_revocation_started_at: null, provider_revocation_status: providerRevocationStatus })
        .eq("id", operation.id)
        .eq("provider_revocation_status", "attempting")
        .select(deletionOperationColumns)
        .maybeSingle();

      if (updateError || !updatedOperation) {
        return { ok: false, message: "Provider cleanup status is still being recorded. Retry shortly.", operation: claimedOperation };
      }

      return { ok: true, operation: updatedOperation };
    }

    operation = await loadDeletionOperationById(adminClient, operation.id);

    if (!operation) {
      return { ok: false, message: "Deletion status could not be verified. Retry shortly.", operation };
    }
  }

  if (operation.provider_revocation_status === "attempting") {
    const startedAt = Date.parse(operation.provider_revocation_started_at ?? "");

    if (Number.isFinite(startedAt) && Date.now() - startedAt < 30_000) {
      return { ok: false, message: "Provider cleanup is still processing. Retry shortly.", operation };
    }

    const { data: failedOperation, error: updateError } = await adminClient
      .from("identity_deletion_operations")
      .update({ provider_revocation_started_at: null, provider_revocation_status: "failed" })
      .eq("id", operation.id)
      .eq("provider_revocation_status", "attempting")
      .select(deletionOperationColumns)
      .maybeSingle();

    if (updateError || !failedOperation) {
      return { ok: false, message: "Provider cleanup status could not be finalized. Retry shortly.", operation };
    }

    operation = failedOperation;
  }

  return { ok: true, operation };
}

async function loadDeletionOperationById(adminClient: any, operationId: string) {
  const { data, error } = await adminClient
    .from("identity_deletion_operations")
    .select(deletionOperationColumns)
    .eq("id", operationId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function recordDeletionError(adminClient: any, operationId: string, code: string) {
  await adminClient
    .from("identity_deletion_operations")
    .update({ last_error_code: code })
    .eq("id", operationId);
}

function processingResponse(message: string, dataDeleted: boolean, authDeleted: boolean) {
  return jsonResponse({
    authDeleted,
    dataDeleted,
    message,
    ok: false,
    retryable: true,
    state: "processing"
  }, 202);
}

function isProviderRevocation(value: unknown) {
  return value === "failed" || value === "not_needed" || value === "succeeded";
}

function createRandomOperationToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function revokeAppleAuthorization(authorizationCode: unknown, nonce: unknown, expectedSubject: string) {
  if (typeof authorizationCode !== "string" || authorizationCode.length < 1 || authorizationCode.length > 2048
    || typeof nonce !== "string" || nonce.length < 1 || nonce.length > 256) {
    return "failed";
  }

  const clientId = Deno.env.get("APPLE_CLIENT_ID");
  const keyId = Deno.env.get("APPLE_KEY_ID");
  const privateKey = Deno.env.get("APPLE_PRIVATE_KEY");
  const teamId = Deno.env.get("APPLE_TEAM_ID");

  if (!clientId || !keyId || !privateKey || !teamId) {
    return "failed";
  }

  try {
    const clientSecret = await createAppleClientSecret(clientId, keyId, privateKey, teamId);
    const tokenResponse = await fetch("https://appleid.apple.com/auth/token", {
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: authorizationCode,
        grant_type: "authorization_code"
      }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
      signal: AbortSignal.timeout(8000)
    });

    if (!tokenResponse.ok) {
      return "failed";
    }

    const tokenData = await tokenResponse.json();
    const token = tokenData.refresh_token ?? tokenData.access_token;

    if (!token || !await verifyAppleIdToken(tokenData.id_token, clientId, expectedSubject, nonce)) {
      return "failed";
    }

    const revokeResponse = await fetch("https://appleid.apple.com/auth/revoke", {
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        token,
        token_type_hint: tokenData.refresh_token ? "refresh_token" : "access_token"
      }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
      signal: AbortSignal.timeout(8000)
    });

    return revokeResponse.ok ? "succeeded" : "failed";
  } catch {
    return "failed";
  }
}

async function createAppleClientSecret(clientId: string, keyId: string, privateKey: string, teamId: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = encodeJson({ alg: "ES256", kid: keyId, typ: "JWT" });
  const payload = encodeJson({
    aud: "https://appleid.apple.com",
    exp: now + 300,
    iat: now,
    iss: teamId,
    sub: clientId
  });
  const signingInput = `${header}.${payload}`;
  const keyBytes = decodeBase64(privateKey.replace(/\\n/g, "\n").replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, ""));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    { hash: "SHA-256", name: "ECDSA" },
    key,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${encodeBase64Url(new Uint8Array(signature))}`;
}

async function verifyAppleIdToken(token: unknown, clientId: string, expectedSubject: string, nonce: string) {
  if (typeof token !== "string") {
    return false;
  }

  try {
    const parts = token.split(".");

    if (parts.length !== 3) {
      return false;
    }

    const header = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])));
    const jwksResponse = await fetch("https://appleid.apple.com/auth/keys", { signal: AbortSignal.timeout(5000) });

    if (!jwksResponse.ok) {
      return false;
    }

    const jwks = await jwksResponse.json();
    const signingKey = Array.isArray(jwks.keys)
      ? jwks.keys.find((key) => key.kid === header.kid && key.alg === "RS256" && key.kty === "RSA")
      : null;

    if (!signingKey || header.alg !== "RS256") {
      return false;
    }

    const key = await crypto.subtle.importKey(
      "jwk",
      signingKey,
      { hash: "SHA-256", name: "RSASSA-PKCS1-v1_5" },
      false,
      ["verify"]
    );
    const signatureValid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      decodeBase64Url(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );
    const expectedNonce = await sha256Hex(nonce);
    const audienceMatches = claims.aud === clientId || (Array.isArray(claims.aud) && claims.aud.includes(clientId));
    const now = Math.floor(Date.now() / 1000);

    return signatureValid
      && claims.iss === "https://appleid.apple.com"
      && audienceMatches
      && claims.sub === expectedSubject
      && typeof claims.exp === "number"
      && claims.exp > now
      && claims.nonce === expectedNonce;
  } catch {
    return false;
  }
}

async function sha256Hex(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function encodeJson(value: Record<string, unknown>) {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function encodeBase64Url(value: Uint8Array) {
  return btoa(String.fromCharCode(...value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function decodeBase64Url(value: string) {
  return decodeBase64(value.replace(/-/g, "+").replace(/_/g, "/"));
}

function decodeBase64(value: string) {
  const padded = value.padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Cache-Control": "no-store", "Content-Type": "application/json" },
    status
  });
}
