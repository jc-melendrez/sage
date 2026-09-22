import { View, StyleSheet } from 'react-native';
import Dashboard from '../../components/Dashboard';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';


export default function HomeScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Dashboard />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});