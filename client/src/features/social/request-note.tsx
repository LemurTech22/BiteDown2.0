import { useState } from 'react';
import { Text, View } from 'react-native';

import type { FoodRequest } from '@/api';
import { useTheme } from '@/theme';

import { hiddenAudienceLabel, requestAge } from './social-utils';
import { socialStyles, TextAction } from './social-ui';

export function RequestNote({ request, onOffer, full = false, lime = false }: {
  request: FoodRequest; onOffer?: () => void; full?: boolean; lime?: boolean;
}) {
  const theme = useTheme();
  const styles = socialStyles(theme);
  const [expanded, setExpanded] = useState(full);
  const [overflow, setOverflow] = useState(false);
  return <View style={[styles.note, lime && styles.noteLime]} testID={`social.request.${request.id}`}>
    <Text style={[styles.meta, { color: theme.colors.inkSecondary, fontWeight: '600' }]}>{request.source.name}</Text>
    {request.audiences.hidden_count > 0 ? <Text style={styles.meta} testID={`social.hidden.${request.id}`}>
      {hiddenAudienceLabel(request.audiences.hidden_count)}
    </Text> : null}
    <View>
      {!expanded ? <Text accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        pointerEvents="none" testID={`social.measure.${request.id}`}
        style={[styles.name, { position: 'absolute', left: 0, right: 0, top: 0, opacity: 0 }]}
        onTextLayout={(event) => setOverflow(event.nativeEvent.lines.length > 4)}>{request.text}</Text> : null}
      <Text style={styles.name} numberOfLines={expanded ? undefined : 4} testID={`social.text.${request.id}`}>{request.text}</Text>
    </View>
    {!expanded && overflow ? <TextAction label="more" accessibilityLabel={`Show the full request from ${request.author_name}`}
      testID={`social.more.${request.id}`} onPress={() => setExpanded(true)} /> : null}
    <View style={[styles.row, { justifyContent: 'space-between' }]}>
      <Text style={styles.meta}>{request.source.type === 'group' ? `${request.author_name}, ` : ''}{requestAge(request.created_at)}</Text>
      {onOffer && request.source.type !== 'me' ? <TextAction label="Offer" filled
        accessibilityLabel={`Offer to ${request.author_name}: ${request.text}`} testID={`social.offer.${request.id}`} onPress={onOffer} /> : null}
    </View>
  </View>;
}
