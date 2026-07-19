import Constants from 'expo-constants';
import { Platform } from 'react-native';

export function getDevMachineHost() {
  const devHost = Constants.expoConfig?.hostUri?.split(':')[0];

  if (devHost && devHost !== 'localhost' && devHost !== '127.0.0.1') {
    return devHost;
  }

  if (Platform.OS === 'android') {
    return '10.0.2.2';
  }

  return 'localhost';
}

export function getDefaultReviewerApiUrl() {
  if (Platform.OS === 'web') {
    return 'http://localhost:3333';
  }

  return `http://${getDevMachineHost()}:3333`;
}
