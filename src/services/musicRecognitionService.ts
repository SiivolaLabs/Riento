import { requestRecordingPermissionsAsync } from "expo-audio";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";

import { missingSupabaseMessage, supabase } from "../lib/supabase";
import { cancelAcrCloudFingerprintOneShotAsync, isMestaAcrCloudAvailable, recognizeAcrCloudFingerprintOneShotAsync } from "../native/mestaAcrCloud";
import { cancelOneShotAsync, isMestaShazamKitAvailable, recognizeOneShotAsync, type MestaShazamKitResult } from "../native/mestaShazamKit";

export type MusicRecognitionCheckStatus = "matched" | "no_match" | "permission_denied" | "provider_unavailable" | "unsupported_platform";

export type MusicRecognitionTrackMatch = {
  artistName?: string;
  confidence?: number;
  title: string;
};

export type MusicRecognitionCheckResult = {
  match?: MusicRecognitionTrackMatch;
  message: string;
  ok: boolean;
  published?: boolean;
  status: MusicRecognitionCheckStatus;
};

type AcrCloudEdgeResult = {
  match?: MusicRecognitionTrackMatch;
  message?: string;
  ok: boolean;
  published?: boolean;
  provider: "acrcloud";
  status: MusicRecognitionCheckStatus;
};

export type MusicRecognitionCheckOptions = {
  venueId: string;
  venueName?: string;
};

let pendingLaunchCheck: { expiresAt: number; token: string; venueId: string } | null = null;

export function createLaunchMusicCheckIntent(venueId: string) {
  const token = Crypto.randomUUID();
  pendingLaunchCheck = { expiresAt: Date.now() + 60_000, token, venueId };
  return token;
}

export function consumeLaunchMusicCheckIntent(venueId: string, token: string) {
  if (!pendingLaunchCheck
    || pendingLaunchCheck.expiresAt < Date.now()
    || pendingLaunchCheck.venueId !== venueId
    || pendingLaunchCheck.token !== token) {
    return false;
  }

  pendingLaunchCheck = null;
  return true;
}

export async function cancelForegroundMusicCheck() {
  if (Platform.OS === "ios" && isMestaShazamKitAvailable()) {
    return cancelOneShotAsync();
  }

  if (Platform.OS === "android" && isMestaAcrCloudAvailable()) {
    return cancelAcrCloudFingerprintOneShotAsync();
  }

  return { ok: false, message: "No native foreground music check is running in this build." };
}

export async function requestForegroundMusicCheck(options: MusicRecognitionCheckOptions): Promise<MusicRecognitionCheckResult> {
  const venueText = options.venueName ? ` at ${options.venueName}` : "";

  if (Platform.OS === "android") {
    return requestAndroidAcrCloudCheck(options, venueText);
  }

  if (Platform.OS !== "ios") {
    return {
      ok: false,
      status: "unsupported_platform",
      message: `Foreground audio matching${venueText} is only configured for native iOS ShazamKit and Android ACRCloud builds. You can still confirm an existing displayed track.`
    };
  }

  if (!isMestaShazamKitAvailable()) {
    return {
      ok: false,
      status: "provider_unavailable",
      message: `ShazamKit matching${venueText} needs an EAS iOS development or internal build that includes Riento's native module. Expo Go cannot run this provider.`
    };
  }

  const permission = await requestRecordingPermissionsAsync();

  if (!permission.granted) {
    return {
      ok: false,
      status: "permission_denied",
      message: "Microphone permission was not granted. You can still confirm what is playing from a venue detail page."
    };
  }

  return mapShazamKitResult(await recognizeOneShotAsync({ venueId: options.venueId, venueName: options.venueName }), venueText);
}

async function requestAndroidAcrCloudCheck(options: MusicRecognitionCheckOptions, venueText: string): Promise<MusicRecognitionCheckResult> {
  if (!isMestaAcrCloudAvailable()) {
    return {
      ok: false,
      status: "provider_unavailable",
      message: `Android music matching${venueText} needs an EAS Android build that includes Riento's ACRCloud fingerprint module. Expo Go cannot run this provider.`
    };
  }

  const permission = await requestRecordingPermissionsAsync();

  if (!permission.granted) {
    return {
      ok: false,
      status: "permission_denied",
      message: "Microphone permission was not granted. You can still confirm what is playing from a venue detail page."
    };
  }

  const fingerprintResult = await recognizeAcrCloudFingerprintOneShotAsync({
    timeoutMs: 12_000,
    venueId: options.venueId,
    venueName: options.venueName
  });

  if (!fingerprintResult.ok || !fingerprintResult.fingerprintBase64) {
    return {
      ok: false,
      status: fingerprintResult.status === "no_match" ? "no_match" : "provider_unavailable",
      message: fingerprintResult.message || `Android ACRCloud fingerprinting is not ready${venueText}. No audio was stored.`
    };
  }

  if (!supabase) {
    return {
      ok: false,
      status: "provider_unavailable",
      message: `${missingSupabaseMessage} Android ACRCloud matching needs Riento's trusted recognition function.`
    };
  }

  const { data, error } = await supabase.functions.invoke<AcrCloudEdgeResult>("recognize-android-music", {
    body: {
      fingerprintBase64: fingerprintResult.fingerprintBase64,
      sampleMs: fingerprintResult.sampleMs,
      venueId: options.venueId
    },
    timeout: 15_000
  });

  if (error || !data) {
    return {
      ok: false,
      status: "provider_unavailable",
      message: `Android ACRCloud matching${venueText} could not reach Riento's trusted recognition function. No now-playing signal was sent.`
    };
  }

  return mapAcrCloudResult(data, venueText);
}

function mapAcrCloudResult(result: AcrCloudEdgeResult, venueText: string): MusicRecognitionCheckResult {
  if (result.status === "matched") {
    if (!result.match?.title) {
      return {
        ok: false,
        status: "provider_unavailable",
        message: `ACRCloud returned an incomplete match${venueText}. No now-playing signal was sent.`
      };
    }

    return {
      ok: true,
      published: result.published === true,
      status: "matched",
      match: result.match,
      message: result.message || `Matched ${formatTrack(result.match)}${venueText}. Publishing the venue-level now-playing signal.`
    };
  }

  if (result.status === "no_match") {
    return {
      ok: false,
      status: "no_match",
      message: result.message || `No ACRCloud match found${venueText}. No new now-playing signal was sent.`
    };
  }

  return {
    ok: false,
    status: result.status === "permission_denied" ? "permission_denied" : "provider_unavailable",
    message: result.message || `Android ACRCloud matching is not ready${venueText}. No raw audio was stored.`
  };
}

function mapShazamKitResult(result: MestaShazamKitResult, venueText: string): MusicRecognitionCheckResult {
  if (result.status === "matched") {
    if (!result.match?.title) {
      return {
        ok: false,
        status: "provider_unavailable",
        message: `ShazamKit returned an incomplete match${venueText}. No now-playing signal was sent.`
      };
    }

    return {
      ok: true,
      published: false,
      status: "matched",
      match: result.match,
      message: result.message || `Matched ${formatTrack(result.match)}${venueText}. This iPhone match stays on this device and was not published.`
    };
  }

  if (result.status === "no_match") {
    return {
      ok: false,
      status: "no_match",
      message: result.message || `No ShazamKit match found${venueText}. No new now-playing signal was sent.`
    };
  }

  return {
    ok: false,
    status: "provider_unavailable",
    message: result.message || `ShazamKit matching is not ready${venueText}. No audio was uploaded or stored.`
  };
}

function formatTrack(match: MusicRecognitionTrackMatch) {
  return match.artistName ? `${match.title} - ${match.artistName}` : match.title;
}
