import { Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import type { UploadFile } from './activityService';

/** 10 MB — matches the server-side cap on both materials and turn-ins. */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

export function formatBytes(n: number): string {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Open the platform document picker, dropping anything over the size cap.
 * Returns the picked files ready to hand to a multipart upload.
 */
export async function pickDocuments(options?: { multiple?: boolean }): Promise<UploadFile[]> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
      multiple: options?.multiple ?? false,
    });
    if (result.canceled) return [];

    const assets = result.assets ?? [];
    const oversized = assets.find((a) => a.size && a.size > MAX_FILE_SIZE);
    if (oversized) {
      Alert.alert('File too large', `"${oversized.name}" is over the 10 MB limit.`);
      return [];
    }
    return assets.map((a) => ({
      uri: a.uri,
      name: a.name,
      mimeType: a.mimeType,
      size: a.size ?? undefined,
    }));
  } catch {
    Alert.alert('Error', 'Failed to open files.');
    return [];
  }
}

/**
 * Write a base64 blob to the cache directory and hand it to the OS share
 * sheet, which is how a student opens a teacher's worksheet or a teacher
 * opens a student's essay on a phone.
 */
export async function shareBase64File(
  base64: string,
  fileName: string,
  mime: string,
): Promise<boolean> {
  try {
    // A unique name stops two uploads with the same filename from colliding
    // in the shared cache directory.
    const safeName = fileName.replace(/[^\w.\-]+/g, '_');
    const unique = `${Date.now()}_${safeName}`;
    const uri = `${FileSystem.cacheDirectory}${unique}`;

    const body = base64.includes('base64,') ? base64.split('base64,')[1] : base64;
    await FileSystem.writeAsStringAsync(uri, body, {
      encoding: FileSystem.EncodingType.Base64,
    });

    if (!(await Sharing.isAvailableAsync())) {
      Alert.alert('Cannot open file', 'File sharing is not available on this device.');
      return false;
    }
    await Sharing.shareAsync(uri, { mimeType: mime });
    return true;
  } catch {
    Alert.alert('Open failed', 'Could not open the file.');
    return false;
  }
}
