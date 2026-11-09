import type { FoodGroup } from '@/api';

export const SPOILAGE_SIGNS: Record<FoodGroup, string[]> = {
  veggies: ['Slimy or dark wet leaves', 'Sour or off smell', 'Yellowing across the bag'],
  fruit: ['Visible mold', 'Leaking or very soft spots', 'Sour or fermented smell'],
  protein: ['Sour or off smell', 'Sticky or slimy surface', 'Unusual discoloration'],
  dairy: ['Visible mold', 'Unexpected curdling or lumps', 'Sour or off smell'],
  grains: ['Visible mold', 'Musty or stale smell', 'Signs of insects'],
  pantry: ['Bulging, leaking or damaged packaging', 'Visible mold', 'Unusual smell or appearance'],
  leftovers: ['Visible mold', 'Sour or off smell', 'Slimy texture'],
  frozen: ['Damaged or leaking packaging', 'Signs of thawing and refreezing', 'Unusual smell after thawing'],
  other: ['Visible mold', 'Unusual smell', 'Changes in color or texture'],
};
