import type { ExpoConfig } from 'expo/config';

// Expo generates debug-only manifests that allow adb reverse + HTTP. Keep the
// main manifest disabled so no release variant can inherit cleartext traffic.

const config: ExpoConfig = {
  name: 'BiteDown',
  slug: 'bitedown',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'bitedown',
  userInterfaceStyle: 'automatic',
  backgroundColor: '#F4F8E8',
  platforms: ['android', 'ios', 'web'],
  ios: {
    bundleIdentifier: 'com.coderedorion.bitedown',
    deploymentTarget: '18.0',
    icon: './assets/expo.icon',
    config: {
      usesNonExemptEncryption: false,
    },
  },
  android: {
    package: 'com.coderedorion.bitedown',
    adaptiveIcon: {
      backgroundColor: '#F4F8E8',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    output: 'single',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    [
      'expo-image-picker',
      {
        cameraPermission: 'Allow BiteDown to take food photos to identify items and predict expiry.',
        photosPermission: 'Allow BiteDown to choose food photos to identify items and predict expiry.',
        microphonePermission: false,
      },
    ],
    [
      'expo-splash-screen',
      {
        backgroundColor: '#F4F8E8',
        image: './assets/images/splash-icon.png',
        imageWidth: 76,
      },
    ],
    [
      'expo-secure-store',
      {
        configureAndroidBackup: true,
        faceIDPermission: 'Allow BiteDown to keep your sign-in session secure.',
      },
    ],
    [
      'expo-build-properties',
      {
        android: {
          compileSdkVersion: 37,
          targetSdkVersion: 36,
          buildToolsVersion: '37.0.0',
          usesCleartextTraffic: false,
        },
        ios: {
          deploymentTarget: '18.0',
        },
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
};

export default config;
