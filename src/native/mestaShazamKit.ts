import { requireOptionalNativeModule } from "expo";

export type MestaShazamKitStatus = "matched" | "no_match" | "provider_unavailable";

export type MestaShazamKitMatch = {
  artistName?: string;
  confidence?: number;
  title: string;
};

export type MestaShazamKitOptions = {
  venueId: string;
  venueName?: string;
};

export type MestaShazamKitResult = {
  match?: MestaShazamKitMatch;
  message: string;
  ok: boolean;
  provider: "shazamkit";
  status: MestaShazamKitStatus;
};

type NativeMestaShazamKitModule = {
  cancelRecognitionAsync?: () => Promise<{ message?: string; ok: boolean }>;
  recognizeOneShotAsync: (options: MestaShazamKitOptions) => Promise<MestaShazamKitResult>;
};

const MestaShazamKit = requireOptionalNativeModule<NativeMestaShazamKitModule>("MestaShazamKit");

export function isMestaShazamKitAvailable() {
  return MestaShazamKit != null;
}

export async function recognizeOneShotAsync(options: MestaShazamKitOptions): Promise<MestaShazamKitResult> {
  if (!MestaShazamKit) {
    return {
      ok: false,
      provider: "shazamkit",
      status: "provider_unavailable",
      message: "ShazamKit is not available in this build. Use an EAS iOS development or internal build that includes Riento's local iOS matching module."
    };
  }

  return MestaShazamKit.recognizeOneShotAsync(options.venueName ? options : { venueId: options.venueId });
}

export async function cancelOneShotAsync() {
  if (!MestaShazamKit?.cancelRecognitionAsync) {
    return { ok: false, message: "No native ShazamKit music check is running in this build." };
  }

  const result = await MestaShazamKit.cancelRecognitionAsync();
  return { ok: result.ok, message: result.message ?? "Stopping the foreground music check..." };
}
