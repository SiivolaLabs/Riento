module.exports = ({ config }) => {
  const googleMapsApiKey = (process.env.GOOGLE_MAPS_API_KEY ?? process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY)?.trim();
  const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim();
  const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();
  const googleIosUrlScheme = getGoogleIosUrlScheme(googleIosClientId);
  const isEasBuild = Boolean(process.env.EAS_BUILD_PROFILE);
  const enableShazamKitEntitlement = process.env.RIENTO_ENABLE_SHAZAMKIT_ENTITLEMENT === "1";
  const iosEntitlements = { ...(config.ios?.entitlements ?? {}) };
  const plugins = (config.plugins ?? []).filter((plugin) => {
    const name = Array.isArray(plugin) ? plugin[0] : plugin;
    return name !== "@react-native-google-signin/google-signin";
  });

  if (isEasBuild && (!googleWebClientId || !googleIosUrlScheme)) {
    throw new Error("EAS builds require EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID and a valid EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID.");
  }

  if (googleIosUrlScheme) {
    plugins.push([
      "@react-native-google-signin/google-signin",
      { iosUrlScheme: googleIosUrlScheme }
    ]);
  }

  if (enableShazamKitEntitlement) {
    iosEntitlements["com.apple.developer.shazamkit"] = true;
  } else {
    delete iosEntitlements["com.apple.developer.shazamkit"];
  }

  const nextConfig = {
    ...config,
    ios: {
      ...config.ios,
      entitlements: iosEntitlements
    },
    plugins,
    extra: {
      ...config.extra,
      androidGoogleMapsConfigured: Boolean(googleMapsApiKey),
      googleIosSignInConfigured: Boolean(googleIosUrlScheme),
      googleWebSignInConfigured: Boolean(googleWebClientId)
    }
  };

  if (!googleMapsApiKey) {
    return nextConfig;
  }

  return {
    ...nextConfig,
    android: {
      ...nextConfig.android,
      config: {
        ...(nextConfig.android?.config ?? {}),
        googleMaps: {
          ...(nextConfig.android?.config?.googleMaps ?? {}),
          apiKey: googleMapsApiKey
        }
      }
    }
  };
};

function getGoogleIosUrlScheme(clientId) {
  const suffix = ".apps.googleusercontent.com";

  if (!clientId?.endsWith(suffix)) {
    return null;
  }

  return `com.googleusercontent.apps.${clientId.slice(0, -suffix.length)}`;
}
