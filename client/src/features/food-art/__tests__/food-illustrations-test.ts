import { FOOD_ILLUSTRATIONS, matchFoodIllustration, type FoodIllustration } from '../food-illustrations';

const synonyms: [string, FoodIllustration][] = [
  ['chicken turkey wings', 'poultry_leg'], ['beef steak pork lamb ground meat', 'cut_of_meat'],
  ['ribs', 'meat_on_bone'], ['salmon tuna cod tilapia trout', 'fish'], ['prawn', 'shrimp'],
  ['lettuce spinach kale cabbage arugula', 'leafy_green'], ['milk', 'glass_of_milk'],
  ['cheddar mozzarella parmesan brie', 'cheese_wedge'], ['orange clementine mandarin', 'tangerine'],
  ['juice', 'beverage_box'], ['coffee tea', 'hot_beverage'], ['rice', 'cooked_rice'],
  ['pasta noodles', 'spaghetti'], ['leftovers', 'takeout_box'], ['soup stew chili', 'pot_of_food'],
  ['jam sauce salsa pickles', 'jar'], ['zucchini', 'cucumber'], ['scallion leek shallot', 'onion'],
  ['yam', 'roasted_sweet_potato'],
];

test.each(synonyms.flatMap(([terms, illustration]) =>
  (terms === 'beef steak pork lamb ground meat' ? ['beef', 'steak', 'pork', 'lamb', 'ground meat'] : terms.split(' '))
    .map((term) => [term, illustration] as const)))('%s matches %s as a whole word', (term, illustration) => {
  expect(matchFoodIllustration(`Fresh ${term.toUpperCase()} (organic)`)).toBe(illustration);
});

test.each([
  ['green apple', 'green_apple'], ['GREEN APPLES', 'green_apple'], ['green-apple slices', 'green_apple'],
  ['apple', 'red_apple'], ['sweet potato', 'roasted_sweet_potato'], ['sweet potatoes', 'roasted_sweet_potato'],
  ['potatoes', 'potato'], ['chili pepper', 'hot_pepper'], ['curry rice', 'curry_rice'],
  ['eggplant', 'eggplant'], ['strawberries', 'strawberry'], ['baby carrots', 'carrot'],
  ['tomatoes', 'tomato'], ['peaches', 'peach'], ['cherries', 'cherries'],
  ['pineapple', 'pineapple'], ['licorice', null], ['teapot', null], ['crabapple', null],
  ['applewood', null], ['mystery food', null], ['', null],
] as const)('%s resolves the most specific match', (name, illustration) => {
  expect(matchFoodIllustration(name)).toBe(illustration);
});

test('all 87 bundled assets have a canonical match and a Jest-compatible asset module', () => {
  expect(Object.keys(FOOD_ILLUSTRATIONS)).toHaveLength(87);
  for (const [name, source] of Object.entries(FOOD_ILLUSTRATIONS)) {
    expect(matchFoodIllustration(name.replaceAll('_', ' '))).toBe(name);
    expect(source).toBeTruthy();
  }
});
