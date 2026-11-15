import type { FoodGroup } from '@/api/types';
import type { IconName } from '@/components/ui/app-icon';

const GROUP_ICONS: Record<FoodGroup, IconName> = {
  protein: 'food-drumstick-outline',
  veggies: 'carrot',
  fruit: 'food-apple-outline',
  dairy: 'cup-outline',
  grains: 'bread-slice-outline',
  pantry: 'package-variant-closed',
  leftovers: 'food-takeout-box-outline',
  frozen: 'snowflake',
  other: 'dots-horizontal-circle-outline',
};

export function groupIcon(foodGroup: FoodGroup): IconName {
  return GROUP_ICONS[foodGroup];
}

