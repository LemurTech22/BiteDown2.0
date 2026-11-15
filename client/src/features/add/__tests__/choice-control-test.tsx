import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { ChoiceControl } from '@/features/add/choice-control';
import { FOOD_GROUPS } from '@/features/fridge/fridge-utils';
import { createTheme } from '@/theme';

test('renders every food group as a content-sized chip in a wrapping row', async () => {
  const theme = createTheme('light');
  const screen = await render(<ChoiceControl label="Food group" options={FOOD_GROUPS}
    value="veggies" onChange={jest.fn()} testID="food.group" />);

  expect(screen.getByTestId('food.group')).toHaveStyle({
    flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs, flexShrink: 0,
  });
  expect(screen.getAllByRole('radio')).toHaveLength(FOOD_GROUPS.length);
  for (const { value, label } of FOOD_GROUPS) {
    expect(screen.getByText(label)).toHaveProp('numberOfLines', 1);
    const chip = screen.getByTestId(`food.group.${value}`);
    expect(chip).toHaveStyle({ minHeight: theme.sizes.touchTarget });
    const style = StyleSheet.flatten(chip.props.style);
    expect(style).not.toHaveProperty('flexBasis');
    expect(style).not.toHaveProperty('flexGrow');
    expect(style).not.toHaveProperty('width');
    expect(style).not.toHaveProperty('height');
  }
});

test('keeps chip selection accessible and respects disabled choices', async () => {
  const onChange = jest.fn();
  const screen = await render(<ChoiceControl label="Food group" options={FOOD_GROUPS}
    value="veggies" onChange={onChange} testID="food.group" />);
  expect(screen.getByLabelText('Food group: Veggies')).toHaveProp('accessibilityState', { checked: true, disabled: false });
  await fireEvent.press(screen.getByLabelText('Food group: Frozen'));
  expect(onChange).toHaveBeenCalledWith('frozen');

  await screen.rerender(<ChoiceControl label="Food group" options={FOOD_GROUPS}
    value="frozen" onChange={onChange} testID="food.group" disabled />);
  onChange.mockClear();
  await fireEvent.press(screen.getByLabelText('Food group: Other'));
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Food group: Frozen')).toHaveProp('accessibilityState', { checked: true, disabled: true });
});
