import Constants from 'expo-constants';
import { Platform } from 'react-native';

const configuredUrl = Constants.expoConfig?.extra?.mockApiUrl;
const emulatorUrl = Platform.OS === 'android' ? 'http://10.0.2.2:8787' : 'http://127.0.0.1:8787';
const deviceUrl = 'http://192.168.0.192:8787';

export const MOCK_API_URL =
  typeof configuredUrl === 'string' && configuredUrl.length > 0
    ? configuredUrl.replace(/\/$/, '')
    : Constants.isDevice
      ? deviceUrl
      : emulatorUrl;
