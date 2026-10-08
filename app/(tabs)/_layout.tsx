import { useEffect, useState } from "react";
import { Tabs } from "expo-router";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { StyleSheet, Text, View } from "react-native";
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MotionPressable } from "../../src/components/MotionPressable";
import { playSelectionHaptic } from "../../src/lib/haptics";
import { colors } from "../../src/theme/colors";

const TAB_BAR_GAP = 6;
const TAB_BAR_INSET = 6;

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <RientoTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.background }
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Map" }} />
      <Tabs.Screen name="leaderboard" options={{ tabBarLabel: "Top", title: "Leaderboard" }} />
      <Tabs.Screen name="profile" options={{ tabBarLabel: "Settings", title: "Settings" }} />
    </Tabs>
  );
}

function RientoTabBar({ descriptors, navigation, state }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const [tabBarWidth, setTabBarWidth] = useState(0);
  const activeOffset = useSharedValue(0);
  const itemWidth = tabBarWidth > 0
    ? (tabBarWidth - TAB_BAR_INSET * 2 - TAB_BAR_GAP * (state.routes.length - 1)) / state.routes.length
    : 0;
  const activePillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: activeOffset.value }]
  }));

  useEffect(() => {
    if (itemWidth <= 0) {
      return;
    }

    activeOffset.value = withSpring(state.index * (itemWidth + TAB_BAR_GAP), {
      damping: 22,
      mass: 0.7,
      reduceMotion: ReduceMotion.System,
      stiffness: 260
    });
  }, [activeOffset, itemWidth, state.index]);

  return (
    <View style={[styles.tabBarShell, { paddingBottom: Math.max(insets.bottom, 14) }]}>
      <View accessibilityRole="tablist" onLayout={(event) => setTabBarWidth(event.nativeEvent.layout.width)} style={styles.tabBar}>
        {itemWidth > 0 && <Animated.View pointerEvents="none" style={[styles.activePill, { width: itemWidth }, activePillStyle]} />}
        {state.routes.map((route, index) => {
          const options = descriptors[route.key]?.options;
          const label = typeof options?.tabBarLabel === "string" ? options.tabBarLabel : options?.title ?? route.name;
          const isFocused = state.index === index;

          function onPress() {
            const event = navigation.emit({
              canPreventDefault: true,
              target: route.key,
              type: "tabPress"
            });

            if (!isFocused && !event.defaultPrevented) {
              playSelectionHaptic();
              navigation.navigate(route.name, route.params);
            }
          }

          return (
            <MotionPressable
              accessibilityRole="tab"
              accessibilityState={isFocused ? { selected: true } : {}}
              containerStyle={styles.tabItemContainer}
              key={route.key}
              onPress={onPress}
              pressedScale={0.98}
              style={styles.tabItem}
            >
              <Text style={[styles.tabItemText, isFocused && styles.tabItemTextActive]}>{label}</Text>
            </MotionPressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  activePill: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    bottom: TAB_BAR_INSET,
    left: TAB_BAR_INSET,
    position: "absolute",
    top: TAB_BAR_INSET
  },
  tabBar: {
    backgroundColor: colors.surfaceGlass,
    borderColor: "rgba(240, 171, 252, 0.26)",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    padding: TAB_BAR_INSET,
    position: "relative"
  },
  tabBarShell: {
    backgroundColor: "transparent",
    paddingHorizontal: 16,
    paddingTop: 0
  },
  tabItem: {
    alignItems: "center",
    borderRadius: 999,
    paddingVertical: 11,
    zIndex: 1
  },
  tabItemContainer: {
    flex: 1,
    zIndex: 1
  },
  tabItemText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800"
  },
  tabItemTextActive: {
    color: colors.background
  }
});
