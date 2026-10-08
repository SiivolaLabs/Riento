import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";

export type SocialAuthProvider = "apple" | "google";

export type SocialProviderCredential = {
  accessToken?: string;
  authorizationCode?: string;
  nonce?: string;
  provider: SocialAuthProvider;
  token: string;
};

export async function requestAppleCredential(): Promise<SocialProviderCredential> {
  if (Platform.OS !== "ios") {
    throw new Error("Sign in with Apple is available in the iOS app.");
  }

  assertNativeBuild("Apple");
  const AppleAuthentication = await import("expo-apple-authentication");

  if (!(await AppleAuthentication.isAvailableAsync())) {
    throw new Error("Sign in with Apple is not available on this device.");
  }

  const nonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
  const credential = await AppleAuthentication.signInAsync({
    nonce: hashedNonce,
    requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL]
  });

  if (!credential.identityToken) {
    throw new Error("Apple did not return a valid identity token.");
  }

  return {
    authorizationCode: credential.authorizationCode ?? undefined,
    nonce,
    provider: "apple",
    token: credential.identityToken
  };
}

export async function requestGoogleCredential(): Promise<SocialProviderCredential> {
  const GoogleSignin = await getGoogleSignin();
  const nonce = Platform.OS === "ios" ? Crypto.randomUUID() : undefined;
  const hashedNonce = nonce
    ? await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce)
    : undefined;

  if (Platform.OS === "android") {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  }

  const response = await GoogleSignin.signIn(hashedNonce
    ? ({ nonce: hashedNonce } as Parameters<typeof GoogleSignin.signIn>[0] & { nonce: string })
    : undefined);

  if (response.type === "cancelled") {
    throw new SocialAuthCancelledError("Google sign-in was cancelled.");
  }

  if (!response.data.idToken) {
    throw new Error("Google did not return a valid identity token.");
  }

  const tokens = await GoogleSignin.getTokens();
  return {
    accessToken: tokens.accessToken,
    nonce,
    provider: "google",
    token: response.data.idToken
  };
}

export async function revokeGoogleAccess(expectedSubject: string) {
  const GoogleSignin = await getGoogleSignin();
  let currentUser = GoogleSignin.getCurrentUser();

  if (!currentUser && GoogleSignin.hasPreviousSignIn()) {
    const response = await GoogleSignin.signInSilently();
    currentUser = response.type === "success" ? response.data : null;
  }

  if (!currentUser || currentUser.user.id !== expectedSubject) {
    throw new Error("The cached Google account does not match the deleted Riento account.");
  }

  await withTimeout(GoogleSignin.revokeAccess(), 8000, "Google access revocation timed out.");
}

export async function clearGoogleLocalSession() {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    return;
  }

  try {
    const GoogleSignin = await getGoogleSignin();
    await withTimeout(GoogleSignin.signOut(), 5000, "Google sign-out timed out.");
  } catch {
    // Supabase sign-out remains authoritative if the native SDK has no cached session.
  }
}

export function isSocialAuthCancellation(error: unknown) {
  return error instanceof SocialAuthCancelledError
    || (typeof error === "object" && error !== null && "code" in error && error.code === "ERR_REQUEST_CANCELED");
}

class SocialAuthCancelledError extends Error {}

function assertNativeBuild(provider: string) {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    throw new Error(`${provider} sign-in requires a Riento preview or production build, not Expo Go.`);
  }
}

async function getGoogleSignin() {
  assertNativeBuild("Google");
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim();
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();

  if (!webClientId || (Platform.OS === "ios" && !iosClientId)) {
    throw new Error("Google sign-in is not configured for this build.");
  }

  const { GoogleSignin } = await import("@react-native-google-signin/google-signin");
  GoogleSignin.configure({
    iosClientId,
    offlineAccess: false,
    scopes: ["email", "profile"],
    webClientId
  });
  return GoogleSignin;
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
