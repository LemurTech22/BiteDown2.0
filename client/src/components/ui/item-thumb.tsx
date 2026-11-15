import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { FoodGroup } from '@/api';
import { FOOD_ILLUSTRATIONS, matchFoodIllustration, type FoodIllustration } from '@/features/food-art/food-illustrations';
import { groupIcon } from '@/features/food-art/group-icon';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/theme';

import { AppIcon } from './app-icon';
import { loadedPhotos, rememberLoaded } from './loaded-photos';

// The signed query changes on every fetch, so the cache key is the URL without it. String split, not URL:
// React Native's URL polyfill does not implement searchParams.delete and would throw.
export function photoCacheKey(uri: string): string {
  return uri.split(/[?#]/)[0];
}

export function ItemThumb({ name, foodGroup, photoUrl, size }: {
  name: string; foodGroup: FoodGroup; photoUrl?: string | null; size?: number;
}) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const dimension = size ?? theme.sizes.itemIcon;
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const [failedIllustration, setFailedIllustration] = useState<FoodIllustration | null>(null);
  // Fade a photo in only the first time it loads in this app session (CL-15, CL-16).
  const [, markLoaded] = useState(0);
  const illustration = matchFoodIllustration(name);
  const showPhoto = Boolean(photoUrl && photoUrl !== failedPhoto);
  const cacheKey = photoUrl ? photoCacheKey(photoUrl) : undefined;
  const group = theme.foodGroups[foodGroup];
  return <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={{ width: dimension, height: dimension, borderRadius: theme.radii.input, overflow: 'hidden',
      alignItems: 'center', justifyContent: 'center', flexShrink: 0, backgroundColor: group.tile }}>
    {showPhoto && photoUrl ? <Image key={`photo:${cacheKey}`} testID="itemThumb.photo" source={{ uri: photoUrl, cacheKey }}
      accessible={false} alt="" contentFit="cover" cachePolicy="memory-disk" recyclingKey={cacheKey}
      transition={reducedMotion || (cacheKey !== undefined && loadedPhotos.has(cacheKey)) ? 0 : theme.motion.quickMs} style={StyleSheet.absoluteFill}
      onLoad={() => { if (cacheKey !== undefined && rememberLoaded(cacheKey)) markLoaded((n) => n + 1); }} onError={() => setFailedPhoto(photoUrl)} /> : illustration && illustration !== failedIllustration ?
      <Image key={`illustration:${illustration}`} testID="itemThumb.illustration" source={FOOD_ILLUSTRATIONS[illustration]}
        accessible={false} alt="" contentFit="contain" transition={0} recyclingKey={illustration}
        style={{ width: dimension - theme.spacing.sm, height: dimension - theme.spacing.sm }}
        onError={() => setFailedIllustration(illustration)} /> :
      <View testID="itemThumb.group"><AppIcon name={groupIcon(foodGroup)} color={group.stroke} size={theme.sizes.icon} /></View>}
  </View>;
}
