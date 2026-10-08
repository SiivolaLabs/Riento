import { forwardRef, useImperativeHandle } from "react";
import { StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";

import { colors } from "../theme/colors";

type WebMapProps = {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

const RientoMap = forwardRef(function RientoMap({ style }: WebMapProps, ref) {
  useImperativeHandle(ref, () => ({ animateToRegion: () => undefined }));

  return (
    <View style={[style, styles.map]}>
      <Text style={styles.kicker}>HELSINKI NIGHTLIFE</Text>
      <Text style={styles.title}>The live venue map is available in the Riento mobile app.</Text>
      <Text style={styles.copy}>Use search and filters here to browse the launch venue set.</Text>
    </View>
  );
});

export function Circle() {
  return null;
}

export function Marker() {
  return null;
}

export const PROVIDER_GOOGLE = undefined;
export default RientoMap;

const styles = StyleSheet.create({
  copy: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    maxWidth: 380,
    textAlign: "center"
  },
  kicker: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.5
  },
  map: {
    alignItems: "center",
    backgroundColor: colors.background,
    gap: 10,
    justifyContent: "center",
    padding: 32
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "800",
    lineHeight: 29,
    maxWidth: 520,
    textAlign: "center"
  }
});
