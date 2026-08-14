import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import LoginScreen from '../components/LoginScreen';

export default function Login() {
  const router = useRouter();
  return (
    <View style={{ flex: 1 }}>
      <LoginScreen />
      {/* TEMP: preview button, remove before shipping */}
      <TouchableOpacity
        style={styles.skipBtn}
        onPress={() => router.replace('/educator/dashboard')}
      >
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  skipBtn: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    backgroundColor: '#7C3AED',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
  },
  skipText: { color: 'white', fontWeight: '700', fontSize: 13 },
});