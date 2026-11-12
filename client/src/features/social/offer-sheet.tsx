import * as Haptics from 'expo-haptics';
import { useRef, useState } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApi, type FoodRequest } from '@/api';
import { reportServerError } from '@/components/server-error';
import { AppButton } from '@/components/ui/app-button';
import { AppIcon, type IconName } from '@/components/ui/app-icon';
import { SkeletonRows } from '@/components/ui/skeleton-rows';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/theme';

import { RequestNote } from './request-note';
import { socialStyles, SocialError } from './social-ui';
import { errorMessage } from './use-social-data';

export function OfferSheet({ request, onClose, onFulfilled }: {
  request: FoodRequest; onClose: () => void; onFulfilled: (request: FoodRequest) => void;
}) {
  const { api } = useApi();
  const theme = useTheme();
  const styles = socialStyles(theme);
  const reducedMotion = useReducedMotion();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  async function fulfil() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError('');
    try {
      const result = await api.fulfilRequest(request.id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onFulfilled(result.request);
      onClose();
    } catch (cause) {
      reportServerError(cause);
      setError(errorMessage(cause));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  const lines: { icon: IconName; text: string }[] = [
    { icon: 'account-outline', text: `${request.author_name} sees that you have it` },
    { icon: 'note-outline', text: 'The note comes off the board' },
    { icon: 'swap-horizontal', text: `You and ${request.author_name} sort out the handoff` },
  ];
  return <Modal visible presentationStyle="pageSheet" animationType={reducedMotion ? 'fade' : 'slide'}
    onRequestClose={() => { if (!busy.current) onClose(); }} testID="offer.sheet.modal">
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: theme.spacing.gutter, justifyContent: 'flex-end' }]}>
        <View accessibilityViewIsModal style={styles.section}>
          <Text accessibilityRole="header" style={styles.heading}>Tell {request.author_name} you have it?</Text>
          <RequestNote request={request} full />
          <View style={styles.card}>{lines.map((line) => <View key={line.icon} style={styles.row}>
            <AppIcon name={line.icon} color={theme.colors.forest} />
            <Text style={[styles.body, { flex: 1 }]}>{line.text}</Text>
          </View>)}</View>
          {pending ? <SkeletonRows testID="offer.loading.skeleton" /> : null}
          {error ? <SocialError screen="offer" message={error} onRetry={() => void fulfil()} /> : null}
          <AppButton label="I have it" testID="offer.confirm.button" onPress={() => void fulfil()} loading={pending} />
          <AppButton label="Cancel" testID="offer.cancel.button" variant="outline" onPress={onClose} disabled={pending} />
        </View>
      </ScrollView>
    </SafeAreaView>
  </Modal>;
}
