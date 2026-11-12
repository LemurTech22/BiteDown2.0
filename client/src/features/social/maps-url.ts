import { Platform } from 'react-native';

export function mapsUrl({ lat, lng, label = '' }: { lat: number; lng: number; label?: string }): string {
  const coordinates = `${lat},${lng}`;
  const encodedLabel = encodeURIComponent(label);
  if (Platform.OS === 'android') return `geo:${coordinates}?q=${coordinates}(${encodedLabel})`;
  if (Platform.OS === 'ios') return `https://maps.apple.com/?ll=${coordinates}&q=${encodedLabel}`;
  return `https://www.google.com/maps/search/?api=1&query=${coordinates}`;
}
