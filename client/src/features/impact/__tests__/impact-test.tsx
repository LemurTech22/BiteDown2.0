import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { ApiError, ApiProvider, type ImpactResponse, MockApiClient } from '@/api';
import ImpactScreen from '@/app/(tabs)/impact';
import { SavedCounter } from '@/features/impact/impact-motion';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

const mockIsFocused = jest.fn(() => true);

jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: jest.fn(() => true) }));
jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    useFocusEffect(effect: () => void | (() => void)) {
      const focused = mockIsFocused();
      React.useEffect(() => focused ? effect() : undefined, [effect, focused]);
    },
  };
});

async function setup() {
  const api = new MockApiClient();
  await api.signup({ email: 'impact@example.com', password: 'impact-password', display_name: 'Contributor' });
  const base = await api.getImpact('month');
  const result: ImpactResponse = {
    ...base,
    saved: { count: 3, kg: 1.2, money: 8.5, co2e_kg: 2.1 },
    used: { count: 2, kg: 1, money: 7, co2e_kg: 1.6 },
    donated: { count: 1, kg: 0.2, money: 1.5, co2e_kg: 0.5 },
    wasted: { count: 1, kg: 0.5, money: 3.5, co2e_kg: 2.25 },
    waste_rate: 0.25,
    previous: { ...base.previous!, saved: { count: 2, kg: 1, money: 7, co2e_kg: 1.6 } },
    waste_reasons: base.waste_reasons.map((reason) => reason.reason === 'forgot'
      ? { ...reason, count: 1, kg: 0.5, money: 3.5, co2e_kg: 2.25, share: 1 } : reason),
    last_6_weeks: base.last_6_weeks.map((week, index) => index === 5 ? { ...week, saved: 3, used: 2, donated: 1, wasted: 1 } : week),
  };
  return { api, result };
}

async function show(api: MockApiClient) {
  return render(<ApiProvider client={api}><ImpactScreen /></ApiProvider>);
}

describe('Impact', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsFocused.mockReturnValue(true);
    jest.mocked(useReducedMotion).mockReturnValue(true);
  });

  test('shows all outcome totals and final saved value immediately with Reduce Motion', async () => {
    const { api, result } = await setup();
    jest.spyOn(api, 'getImpact').mockResolvedValue(result);
    const screen = await show(api);
    await screen.findByTestId('impact.hero.card');
    expect(screen.getByTestId('impact.saved.value')).toHaveTextContent('2.6 lb');
    expect(screen.getByTestId('impact.items.value')).toHaveTextContent('3');
    expect(screen.getByTestId('impact.money.value')).toHaveTextContent('$8.50');
    expect(screen.getByTestId('impact.carbon.value')).toHaveTextContent('4.6 lb of carbon emissions avoided');
    expect(screen.getByTestId('impact.wasteRate.value')).toHaveTextContent('25.0%');
    expect(screen.getByTestId('impact.used.value')).toHaveTextContent('2 items · 2.2 lb');
    expect(screen.getByTestId('impact.donated.value')).toHaveTextContent('1 item · 7.1 oz');
    expect(screen.getByTestId('impact.wasted.value')).toHaveTextContent('1 item · 1.1 lb');
    expect(screen.getByText('Forgot about it · 1 item · 100.0%')).toBeTruthy();
    expect(screen.getAllByTestId(/^impact\.week\./)).toHaveLength(6);
    expect(screen.getByLabelText(/3 saved, 2 used, 1 donated, 1 thrown out/)).toBeTruthy();
  });

  test('switching ranges refetches, updates totals and selection, and hides comparison for all', async () => {
    const { api, result } = await setup();
    const getImpact = jest.spyOn(api, 'getImpact').mockImplementation(async (range = 'all') => ({
      ...result, range, saved: { ...result.saved, money: range === 'week' ? 4 : 8.5 },
      previous: range === 'all' ? null : result.previous,
    }));
    const screen = await show(api);
    await screen.findByTestId('impact.money.value');
    expect(getImpact).toHaveBeenCalledWith('month');
    expect(screen.getByTestId('impact.saved.change')).toHaveTextContent('Up 7.1 oz vs previous 30 days');
    expect(screen.getByText('Up $1.50 vs previous')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('impact.range.week'));
    await waitFor(() => expect(screen.getByTestId('impact.money.value')).toHaveTextContent('$4.00'));
    expect(getImpact).toHaveBeenLastCalledWith('week');
    expect(screen.getByTestId('impact.range.week').props.accessibilityState.checked).toBe(true);
    expect(screen.getByTestId('impact.saved.change')).toHaveTextContent('Up 7.1 oz vs previous 7 days');
    await fireEvent.press(screen.getByTestId('impact.range.all'));
    await screen.findByTestId('impact.saved.value');
    expect(getImpact).toHaveBeenLastCalledWith('all');
    expect(screen.queryByTestId('impact.saved.change')).toBeNull();
    expect(getImpact).toHaveBeenCalledTimes(3);
    await fireEvent.press(screen.getByTestId('impact.range.all'));
    expect(getImpact).toHaveBeenCalledTimes(3);
  });

  test('shows an empty state and zero totals from MockApiClient', async () => {
    const { api } = await setup();
    const screen = await show(api);
    expect(await screen.findByTestId('impact.empty.state')).toBeTruthy();
    expect(screen.getByTestId('impact.saved.value')).toHaveTextContent('0.0 lb');
    expect(screen.getByTestId('impact.money.value')).toHaveTextContent('$0.00');
    expect(screen.getByTestId('impact.wasteRate.value')).toHaveTextContent('0.0%');
    expect(screen.getByText('No food thrown out in this range.')).toBeTruthy();
  });

  test('shows skeleton loading and retries API errors', async () => {
    const { api, result } = await setup();
    let fail!: (reason: Error) => void;
    const getImpact = jest.spyOn(api, 'getImpact').mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }))
      .mockResolvedValue(result);
    const screen = await show(api);
    expect(screen.getByTestId('impact.loading.skeleton')).toBeTruthy();
    await act(() => fail(new ApiError(503, 'unavailable', 'Impact is unavailable.')));
    expect(await screen.findByText('Impact is unavailable.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('impact.retry.button'));
    expect(await screen.findByTestId('impact.hero.card')).toBeTruthy();
    expect(getImpact).toHaveBeenCalledTimes(2);
    expect(getImpact).toHaveBeenLastCalledWith('month');
  });

  test('ignores stale results when ranges change during a request', async () => {
    const { api, result } = await setup();
    let finishMonth!: (value: ImpactResponse) => void;
    const getImpact = jest.spyOn(api, 'getImpact').mockImplementationOnce(() => new Promise((resolve) => { finishMonth = resolve; }))
      .mockResolvedValue({ ...result, range: 'week', saved: { ...result.saved, money: 4 } });
    const screen = await show(api);
    await fireEvent.press(screen.getByTestId('impact.range.week'));
    await screen.findByTestId('impact.money.value');
    await act(() => finishMonth(result));
    expect(screen.getByTestId('impact.money.value')).toHaveTextContent('$4.00');
    expect(getImpact).toHaveBeenCalledTimes(2);
  });

  test('uses the supplied count-based waste rate instead of a weight ratio', async () => {
    const { api, result } = await setup();
    jest.spyOn(api, 'getImpact').mockResolvedValue({ ...result, waste_rate: 0.25, wasted: { ...result.wasted, kg: 10 } });
    const screen = await show(api);
    expect(await screen.findByTestId('impact.wasteRate.value')).toHaveTextContent('25.0%');
    expect(screen.getByTestId('impact.wasteRate.meter')).toHaveAccessibilityValue({ min: 0, max: 100, now: 25, text: '25.0%' });
  });

  test('renders used and donated totals generated by MockApiClient events', async () => {
    const { api } = await setup();
    const { items } = await api.createItems({ items: [
      { name: 'Apples', quantity: 2, est_weight_kg: 1, est_price: 4 },
      { name: 'Bread', quantity: 1, est_weight_kg: 0.5, est_price: 3 },
    ] });
    await api.removeItem(items[0].id, { outcome: 'used' });
    await api.removeItem(items[1].id, { outcome: 'donated' });
    const screen = await show(api);
    expect(await screen.findByTestId('impact.saved.value')).toHaveTextContent('3.3 lb');
    expect(screen.getByTestId('impact.items.value')).toHaveTextContent('2');
    expect(screen.getByTestId('impact.money.value')).toHaveTextContent('$7.00');
    expect(screen.getByText('1 used · 1 donated')).toBeTruthy();
  });

  test('a running counter switches straight to its final value when Reduce Motion is enabled', async () => {
    jest.useFakeTimers();
    try {
      jest.mocked(useReducedMotion).mockReturnValue(false);
      const format = (value: number) => value.toFixed(0);
      const screen = await render(<SavedCounter value={12} format={format} style={undefined} />);
      expect(screen.getByTestId('impact.saved.value')).toHaveTextContent('0');
      await act(() => jest.advanceTimersByTime(100));
      jest.mocked(useReducedMotion).mockReturnValue(true);
      await screen.rerender(<SavedCounter value={12} format={format} style={undefined} />);
      expect(screen.getByTestId('impact.saved.value')).toHaveTextContent('12');
      await screen.unmount();
    } finally {
      jest.useRealTimers();
    }
  });

  test('returning to the tab refetches totals after food activity elsewhere', async () => {
    const { api } = await setup();
    const getImpact = jest.spyOn(api, 'getImpact');
    const screen = await show(api);
    await screen.findByTestId('impact.empty.state');
    mockIsFocused.mockReturnValue(false);
    await screen.rerender(<ApiProvider client={api}><ImpactScreen /></ApiProvider>);
    const { items } = await api.createItems({ items: [{ name: 'Apples', est_weight_kg: 1, est_price: 4 }] });
    await api.removeItem(items[0].id, { outcome: 'used' });
    mockIsFocused.mockReturnValue(true);
    await screen.rerender(<ApiProvider client={api}><ImpactScreen /></ApiProvider>);
    await waitFor(() => expect(screen.getByTestId('impact.saved.value')).toHaveTextContent('2.2 lb'));
    expect(screen.queryByTestId('impact.empty.state')).toBeNull();
    expect(screen.getByTestId('impact.money.value')).toHaveTextContent('$4.00');
    expect(getImpact).toHaveBeenCalledTimes(2);
    expect(getImpact).toHaveBeenLastCalledWith('month');
  });
});
