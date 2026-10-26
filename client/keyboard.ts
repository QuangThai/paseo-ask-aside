import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Dimensions, Keyboard, Platform, type KeyboardEvent, type View } from "react-native";

// Space between the question box and the keyboard: the iOS keyboard floats with rounded
// corners above its reported top edge.
const KEYBOARD_GAP = 16;
// Plugins get no safe-area insets, so these follow the system bars: the iPhone home indicator
// in portrait and landscape, the iPad one, and Android's gesture or button bar.
const IPHONE_HOME_INDICATOR = { portrait: 34, landscape: 21 };
const IPAD_HOME_INDICATOR = 20;
const ANDROID_NAVIGATION_BAR = 24;

/**
 * Bottom padding that keeps a full-height view's question box visible on phones: above the
 * keyboard while it is up, and above the home indicator or navigation bar otherwise. Paseo
 * shows the panel as a tab on phones and leaves both to the plugin. The view is measured
 * against the keyboard's top edge and the screen's bottom, so nothing is added where the host
 * already keeps the view clear, such as above a tab bar or when Android resizes the window.
 * Pass `remeasure` to the view's onLayout.
 */
export function useBottomClearance(view: RefObject<View | null>): { padding: number; remeasure: () => void } {
  const [padding, setPadding] = useState(0);
  const keyboardTop = useRef<number | null>(null);

  const remeasure = useCallback(() => {
    if (Platform.OS === "web" || !view.current) return;
    view.current.measureInWindow((_x, y, _width, height) => {
      const bottom = y + height;
      const top = keyboardTop.current;
      if (top !== null) {
        const covered = Math.round(bottom - top);
        setPadding(covered > 0 ? covered + KEYBOARD_GAP : 0);
        return;
      }
      const screen = Dimensions.get("window");
      // Only a view that reaches the bottom of the screen sits behind the system bar.
      setPadding(bottom >= screen.height - 1 ? systemBarHeight(screen.width, screen.height) : 0);
    });
  }, [view]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const show = (event: KeyboardEvent) => {
      keyboardTop.current = event.endCoordinates.screenY;
      remeasure();
    };
    const hide = () => {
      keyboardTop.current = null;
      remeasure();
    };
    // iOS reports the keyboard before it animates in; Android only once it is shown. Rotation
    // or a change of keyboard height arrives as another show event.
    const subscriptions = [
      ...(Platform.OS === "ios"
        ? [Keyboard.addListener("keyboardWillShow", show), Keyboard.addListener("keyboardWillHide", hide)]
        : [Keyboard.addListener("keyboardDidShow", show), Keyboard.addListener("keyboardDidHide", hide)]),
      Dimensions.addEventListener("change", remeasure),
    ];
    return () => {
      for (const subscription of subscriptions) subscription.remove();
    };
  }, [remeasure]);

  return { padding, remeasure };
}

function systemBarHeight(width: number, height: number): number {
  if (Platform.OS === "android") return ANDROID_NAVIGATION_BAR;
  if (Platform.OS !== "ios") return 0;
  if ((Platform as { isPad?: boolean }).isPad) return IPAD_HOME_INDICATOR;
  // iPhones with a home indicator have screens taller than 2:1; older ones with a Home button do not.
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  if (long / short <= 2) return 0;
  return height >= width ? IPHONE_HOME_INDICATOR.portrait : IPHONE_HOME_INDICATOR.landscape;
}
