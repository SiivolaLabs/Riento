import { requireOptionalNativeModule } from "expo";

export type MestaAcrCloudFingerprintStatus = "fingerprinted" | "no_match" | "provider_unavailable";

export type MestaAcrCloudOptions = {
  timeoutMs?: number;
  venueId: string;
  venueName?: string;
};

export type MestaAcrCloudFingerprintResult = {
  fingerprintBase64?: string;
  message: string;
  ok: boolean;
  provider: "acrcloud";
  sampleMs?: number;
  status: MestaAcrCloudFingerprintStatus;
};

type NativeMestaAcrCloudModule = {
  cancelRecognitionAsync?: () => Promise<{ message?: string; ok: boolean }>;
  recognizeOneShotAsync: (options: MestaAcrCloudOptions) => Promise<MestaAcrCloudFingerprintResult>;
};

const MestaAcrCloud = requireOptionalNativeModule<NativeMestaAcrCloudModule>("MestaAcrCloud");

export function isMestaAcrCloudAvailable() {
  return MestaAcrCloud != null;
}

export async function recognizeAcrCloudFingerprintOneShotAsync(options: MestaAcrCloudOptions): Promise<MestaAcrCloudFingerprintResult> {
  if (!MestaAcrCloud) {
    return {
      ok: false,
      provider: "acrcloud",
      status: "provider_unavailable",
      message: "Android ACRCloud fingerprinting is not available in this build. Use an EAS Android build that includes Riento's local Android fingerprint module."
    };
  }

  return MestaAcrCloud.recognizeOneShotAsync(options.venueName ? options : { timeoutMs: options.timeoutMs, venueId: options.venueId });
}

export async function cancelAcrCloudFingerprintOneShotAsync() {
  if (!MestaAcrCloud?.cancelRecognitionAsync) {
    return { ok: false, message: "No native Android fingerprint music check is running in this build." };
  }

  const result = await MestaAcrCloud.cancelRecognitionAsync();
  return { ok: result.ok, message: result.message ?? "Stopping the Android foreground music check..." };
}
