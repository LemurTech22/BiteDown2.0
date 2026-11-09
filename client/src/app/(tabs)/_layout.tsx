import { Redirect, router, Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/auth-provider';
import { AppIcon, type IconName } from '@/components/ui/app-icon';
import { SkeletonRows } from '@/components/ui/skeleton-rows';
import { useTheme } from '@/theme';

function tabIcon(name: IconName) {
  return function TabIcon({ color }: { color: ComponentProps<typeof AppIcon>['color'] }) {
    return <AppIcon name={name} color={color} />;
  };
}

export default function TabLayout() {
  const theme = useTheme();
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.ground, padding: theme.spacing.gutter }}>
        <SkeletonRows testID="tabs.loading.skeleton" />
      </SafeAreaView>
    );
  }
  if (status !== 'authenticated') return <Redirect href="/" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.forest,
        tabBarInactiveTintColor: theme.colors.tabInactive,
        tabBarActiveBackgroundColor: theme.colors.limeTint,
        tabBarHideOnKeyboard: true,
        tabBarItemStyle: {
          borderRadius: theme.radii.control,
          minHeight: theme.sizes.touchTarget,
        },
        tabBarLabelStyle: theme.type.tabLabel,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.hairline,
          borderTopWidth: theme.sizes.borderHairline,
          minHeight: theme.sizes.tabBar,
          paddingVertical: theme.spacing.xs,
        },
      }}>
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarAccessibilityLabel: 'Home tab',
          tabBarButtonTestID: 'tabs.home.button',
          tabBarIcon: tabIcon('home-outline'),
        }}
      />
      <Tabs.Screen
        name="fridge"
        options={{
          title: 'Fridge',
          tabBarAccessibilityLabel: 'Fridge tab',
          tabBarButtonTestID: 'tabs.fridge.button',
          tabBarIcon: tabIcon('fridge-outline'),
        }}
      />
      <Tabs.Screen
        name="add"
        listeners={{
          tabPress: (event) => {
            event.preventDefault();
            router.push('/add-modal');
          },
        }}
        options={{
          title: 'Add',
          tabBarAccessibilityLabel: 'Add food',
          tabBarButtonTestID: 'tabs.add.button',
          tabBarIcon: tabIcon('plus-circle'),
        }}
      />
      <Tabs.Screen
        name="social"
        options={{
          title: 'Social',
          tabBarAccessibilityLabel: 'Social tab',
          tabBarButtonTestID: 'tabs.social.button',
          tabBarIcon: tabIcon('account-group-outline'),
        }}
      />
      <Tabs.Screen
        name="impact"
        options={{
          title: 'Impact',
          tabBarAccessibilityLabel: 'Impact tab',
          tabBarButtonTestID: 'tabs.impact.button',
          tabBarIcon: tabIcon('leaf-circle-outline'),
        }}
      />
    </Tabs>
  );
}
