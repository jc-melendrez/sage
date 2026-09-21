import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import LoginScreen from '../../components/LoginScreen';
import Dashboard from '../../components/Dashboard';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';


export default function HomeScreen() {
  const [isLoggedIn, setIsLoggedIn] = useState(true);

  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  if (!isLoggedIn) {
    return <LoginScreen onLogin={() => setIsLoggedIn(true)} />;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Dashboard />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
