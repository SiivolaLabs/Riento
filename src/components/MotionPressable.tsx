import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";

type MotionPressableProps = PressableProps & {
  containerStyle?: StyleProp<ViewStyle>;
  pressedScale?: number;
};

export function MotionPressable({ containerStyle, disabled, onPressIn, onPressOut, pressedScale = 0.97, style, ...props }: MotionPressableProps) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: reduceMotion ? 1 : scale.value }]
  }));

  return (
    <Animated.View style={[containerStyle, animatedStyle]}>
      <Pressable
        {...props}
        disabled={disabled}
        onPressIn={(event) => {
          if (!disabled) {
            scale.value = withTiming(pressedScale, { duration: 90 });
          }
          onPressIn?.(event);
        }}
        onPressOut={(event) => {
          scale.value = withTiming(1, { duration: 130 });
          onPressOut?.(event);
        }}
        style={style}
      />
    </Animated.View>
  );
}
