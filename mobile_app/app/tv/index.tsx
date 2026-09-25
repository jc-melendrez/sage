import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';

const COLORS = {
  bg: '#0f0c29',
  bgSecondary: '#1a1640',
  surface: '#1e1b4b',
  purplePrimary: '#7C3AED',
  accent: '#22D3EE',
  textPrimary: '#FFFFFF',
  textSecondary: '#CBD5E1',
  textMuted: '#94A3B8',
  cardBorder: 'rgba(127, 119, 221, 0.3)',
};

const FONTS = {
  black: 'Montserrat-Black',
  extraBold: 'Montserrat-ExtraBold',
  bold: 'Montserrat-Bold',
  medium: 'Montserrat-Medium',
  regular: 'Montserrat-Regular',
};

export default function TvLandingScreen() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleJoin = () => {
    const clean = code.trim().toUpperCase();
    if (clean.length === 0) {
      setError('Enter a room code');
      return;
    }
    setError(null);
    router.replace(`/tv/${clean}`);
  };

  const onChangeCode = (value: string) => {
    setCode(value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8));
    if (error) setError(null);
  };

  return (
    <LinearGradient
      colors={[COLORS.bg, COLORS.bgSecondary]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.root}
    >
      <View style={styles.center}>
        <Text style={styles.kicker}>SAGE · LIVE</Text>
        <Text style={styles.title}>TV LEADERBOARD</Text>
        <Text style={styles.sub}>
          Enter the room code to open the live leaderboard
        </Text>

        <TextInput
          style={styles.input}
          value={code}
          onChangeText={onChangeCode}
          placeholder="ROOM CODE"
          placeholderTextColor={COLORS.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          onSubmitEditing={handleJoin}
          selectionColor={COLORS.accent}
        />

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={handleJoin}
        >
          <Text style={styles.buttonText}>ENTER ROOM</Text>
        </Pressable>

        <Text style={styles.foot}>
          Start a game in the app, then share its code here
        </Text>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  kicker: {
    fontSize: 15,
    fontFamily: FONTS.extraBold,
    letterSpacing: 4,
    color: COLORS.accent,
    marginBottom: 10,
  },
  title: {
    fontSize: 40,
    fontFamily: FONTS.black,
    color: COLORS.textPrimary,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  sub: {
    fontSize: 16,
    fontFamily: FONTS.regular,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 36,
  },
  input: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: COLORS.surface,
    borderWidth: 2,
    borderColor: COLORS.cardBorder,
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 16,
    fontSize: 26,
    fontFamily: FONTS.extraBold,
    letterSpacing: 6,
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  error: {
    fontSize: 14,
    fontFamily: FONTS.medium,
    color: '#F87171',
    marginTop: 12,
  },
  button: {
    marginTop: 20,
    backgroundColor: COLORS.purplePrimary,
    borderRadius: 16,
    paddingHorizontal: 48,
    paddingVertical: 16,
  },
  buttonPressed: { opacity: 0.85 },
  buttonText: {
    fontSize: 18,
    fontFamily: FONTS.extraBold,
    letterSpacing: 2,
    color: COLORS.textPrimary,
  },
  foot: {
    fontSize: 13,
    fontFamily: FONTS.medium,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 32,
  },
});