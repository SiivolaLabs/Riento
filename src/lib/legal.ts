import "react-native-url-polyfill/auto";

import * as Linking from "expo-linking";

const defaultLegalBaseUrl = "https://riento.expo.app/legal";

export const legalPages = {
  accountDeletion: "ACCOUNT_DELETION.html",
  communityGuidelines: "COMMUNITY_GUIDELINES.html",
  privacyPolicy: "PRIVACY_POLICY.html",
  support: "SUPPORT.html",
  terms: "TERMS.html"
} as const;

export type LegalPageName = (typeof legalPages)[keyof typeof legalPages];

const legalPageAllowList = new Set<string>(Object.values(legalPages));

export function hasConfiguredLegalPages() {
  const configuredBaseUrl = getLegalBaseUrl();

  if (!configuredBaseUrl) {
    return false;
  }

  try {
    return new URL(configuredBaseUrl).protocol === "https:";
  } catch {
    return false;
  }
}

export async function openLegalPage(page: LegalPageName) {
  if (!legalPageAllowList.has(page)) {
    return { ok: false as const, message: "That legal page is not available." };
  }

  const configuredBaseUrl = getLegalBaseUrl();

  if (!configuredBaseUrl) {
    return { ok: false as const, message: "Legal and support pages are not configured in this build." };
  }

  try {
    const pageUrl = new URL(configuredBaseUrl);

    if (pageUrl.protocol !== "https:") {
      return { ok: false as const, message: "Legal and support pages require a secure HTTPS address." };
    }

    pageUrl.hash = "";
    pageUrl.pathname = `${pageUrl.pathname.replace(/\/+$/, "")}/${page}`;
    pageUrl.search = "";
    const url = pageUrl.toString();

    if (!(await Linking.canOpenURL(url))) {
      return { ok: false as const, message: "This device could not open the legal or support page." };
    }

    await Linking.openURL(url);
    return { ok: true as const, message: "Opened in your browser." };
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "Could not open the legal or support page."
    };
  }
}

export function getLegalBaseUrl() {
  const explicitBaseUrl = process.env.EXPO_PUBLIC_LEGAL_BASE_URL?.trim();

  if (explicitBaseUrl) {
    return explicitBaseUrl;
  }

  return defaultLegalBaseUrl;
}
