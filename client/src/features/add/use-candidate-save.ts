import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { useApi } from '@/api';

import { type CandidateDraft, draftError, toCreateItem } from './candidate-editor';

export function useCandidateSave(groupId?: string) {
  const { api } = useApi();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const busy = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

  async function save(drafts: CandidateDraft[]) {
    if (busy.current || !drafts.length || drafts.some(draftError)) return;
    busy.current = true;
    setSaving(true);
    setSaveError('');
    try {
      await api.createItems({ items: drafts.map((draft) => toCreateItem(draft, 'single')), ...(groupId ? { group_id: groupId } : {}) });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (active.current) {
        if (groupId && router.canGoBack()) router.back();
        else router.dismissTo('/fridge');
      }
    } catch (cause) {
      if (active.current) {
        setSaveError(cause instanceof Error ? cause.message : 'We couldn’t save your food. Try again.');
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      }
    } finally {
      busy.current = false;
      if (active.current) setSaving(false);
    }
  }
  return { saving, saveError, setSaveError, save };
}
