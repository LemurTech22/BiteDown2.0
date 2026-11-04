import { useColorScheme } from 'react-native';

import { colors, foodGroupColors, motion, radii, sizes, spacing, typeScale } from './tokens';

export function createTheme(scheme: 'light' | 'dark') {
  return {
    scheme,
    colors: colors[scheme],
    foodGroups: foodGroupColors[scheme],
    spacing,
    radii,
    sizes,
    type: typeScale,
    motion,
  };
}

export type AppTheme = ReturnType<typeof createTheme>;

export function useTheme(): AppTheme {
  return createTheme(useColorScheme() === 'dark' ? 'dark' : 'light');
}

export * from './tokens';
