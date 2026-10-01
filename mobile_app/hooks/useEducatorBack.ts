import { useCallback } from 'react';
import { useNavigation, useRouter, type Href } from 'expo-router';

/**
 * Back handler for the educator shell.
 *
 * The educator detail screens live as `href: null` siblings inside the educator
 * tab navigator rather than in a stack, so `router.push()` into one is downgraded
 * to a tab jump and never creates a stack entry. With `backBehavior="history"` on
 * that navigator (see app/educator/(tabs)/_layout.tsx) the tab history accumulates
 * and `goBack()` resolves to the screen you actually came from.
 *
 * `navigation.canGoBack()` is "would dispatching goBack produce a state?" — it is
 * false when the history is a single entry. That happens on a cold start or a deep
 * link straight into a detail screen, where there is nothing to go back to and
 * `goBack()` would bubble up and close the app. Fall back to the dashboard there.
 */
export function useEducatorBack(fallback: Href = '/educator/dashboard') {
  const navigation = useNavigation();
  const router = useRouter();

  return useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    router.navigate(fallback);
  }, [navigation, router, fallback]);
}
