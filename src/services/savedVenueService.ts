import AsyncStorage from "@react-native-async-storage/async-storage";

const savedVenueSlugsKey = "riento.savedVenueSlugs.v1";
const listeners = new Set<(slugs: Set<string>) => void>();

export async function getSavedVenueSlugs() {
  const storedValue = await AsyncStorage.getItem(savedVenueSlugsKey);

  if (!storedValue) {
    return new Set<string>();
  }

  try {
    const parsedValue: unknown = JSON.parse(storedValue);

    if (!Array.isArray(parsedValue)) {
      return new Set<string>();
    }

    return new Set(parsedValue.filter((value): value is string => typeof value === "string" && value.length > 0));
  } catch {
    return new Set<string>();
  }
}

export async function setVenueSaved(slug: string, isSaved: boolean) {
  const nextSlugs = await getSavedVenueSlugs();

  if (isSaved) {
    nextSlugs.add(slug);
  } else {
    nextSlugs.delete(slug);
  }

  await AsyncStorage.setItem(savedVenueSlugsKey, JSON.stringify([...nextSlugs].sort()));
  notify(nextSlugs);
  return { ok: true, message: isSaved ? "Saved on this device." : "Removed from My spots." };
}

export async function clearSavedVenues() {
  await AsyncStorage.removeItem(savedVenueSlugsKey);
  notify(new Set());
}

export function subscribeToSavedVenues(listener: (slugs: Set<string>) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(slugs: Set<string>) {
  listeners.forEach((listener) => listener(new Set(slugs)));
}
