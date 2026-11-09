import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';

import { useTheme } from '@/theme';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

interface AppIconProps {
  name: IconName;
  color: string;
  size?: number;
}

export function AppIcon({ name, color, size }: AppIconProps) {
  const theme = useTheme();
  return (
    <MaterialCommunityIcons
      accessibilityElementsHidden
      importantForAccessibility="no"
      name={name}
      color={color}
      size={size ?? theme.sizes.iconLarge}
    />
  );
}

export type { IconName };
