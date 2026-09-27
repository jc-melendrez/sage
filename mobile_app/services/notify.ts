import { Alert, InteractionManager } from 'react-native';

/**
 * Show an Alert once the current modal has finished closing.
 *
 * On Android a `<Modal>` renders in its own native window. Raising an Alert in
 * the same tick that the modal starts tearing down is silently dropped, which
 * is why both the "Shared!" confirmation and the failure alerts never
 * appeared: the code closed the share sheet and alerted in one tick.
 * `runAfterInteractions` fires once that window is gone.
 *
 * Use this for any feedback that follows closing a sheet or modal. Use plain
 * `Alert.alert` only when no modal is being dismissed.
 */
export function notify(title: string, message?: string) {
  InteractionManager.runAfterInteractions(() => {
    Alert.alert(title, message);
  });
}
