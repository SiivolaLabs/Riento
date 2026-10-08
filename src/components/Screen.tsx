import { PropsWithChildren } from "react";
import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors } from "../theme/colors";

export function Screen({ children }: PropsWithChildren) {
  return <SafeAreaView edges={["top"]} style={styles.container}>{children}</SafeAreaView>;
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background,
    flex: 1
  }
});
