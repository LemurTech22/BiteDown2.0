import { Platform } from 'react-native';

import { mapsUrl } from '../maps-url';

afterEach(() => jest.restoreAllMocks());

test('Android encodes parentheses inside a geo label', () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  expect(mapsUrl({ lat: 29.7, lng: -95.3, label: 'Pantry (north)' }))
    .toBe('geo:29.7,-95.3?q=29.7,-95.3(Pantry%20%28north%29)');
});

test.each([
  ['android', 'geo:29.7,-95.3?q=29.7,-95.3(Caf%C3%A9%20%26%20pantry%20%231)'],
  ['ios', 'https://maps.apple.com/?ll=29.7,-95.3&q=Caf%C3%A9%20%26%20pantry%20%231'],
  ['web', 'https://www.google.com/maps/search/?api=1&query=29.7,-95.3'],
  ['windows', 'https://www.google.com/maps/search/?api=1&query=29.7,-95.3'],
] as const)('opens pickup coordinates on %s and encodes the label', (platform, expected) => {
  jest.replaceProperty(Platform, 'OS', platform);
  expect(mapsUrl({ lat: 29.7, lng: -95.3, label: 'Café & pantry #1' })).toBe(expected);
});

test.each([
  ['android', 'geo:0,0?q=0,0()'],
  ['ios', 'https://maps.apple.com/?ll=0,0&q='],
  ['web', 'https://www.google.com/maps/search/?api=1&query=0,0'],
] as const)('accepts an omitted label and zero coordinates on %s', (platform, expected) => {
  jest.replaceProperty(Platform, 'OS', platform);
  expect(mapsUrl({ lat: 0, lng: 0 })).toBe(expected);
});
