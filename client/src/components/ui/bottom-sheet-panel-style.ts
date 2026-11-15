import type { ViewStyle } from 'react-native';

import type { AppTheme } from '@/theme';

export function bottomSheetPanelStyle(theme: AppTheme): ViewStyle {
  return {
    width: '100%',
    maxWidth: theme.sizes.webMaxContentWidth,
    alignSelf: 'center',
  };
}
