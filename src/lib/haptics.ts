import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

export function playSelectionHaptic() {
  if (Platform.OS === "web") {
    return;
  }

  const feedback = Platform.OS === "android"
    ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Segment_Tick)
    : Haptics.selectionAsync();

  void feedback.catch(() => undefined);
}

export function playSuccessHaptic() {
  if (Platform.OS === "web") {
    return;
  }

  const feedback = Platform.OS === "android"
    ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Confirm)
    : Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

  void feedback.catch(() => undefined);
}
