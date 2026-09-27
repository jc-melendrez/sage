/**
 * Study-material document picking and upload.
 *
 * One allowlist for every picker in the app (AI chat attachments, AI quiz
 * generation, lesson/topic generation) so the same file is accepted in the
 * same places.
 *
 * Android's document provider reports unreliable MIME types for Office
 * documents — a .docx frequently comes back as
 * application/octet-stream, and some providers report
 * application/msword for .docx. So we ask for everything and gate on the
 * file extension ourselves.
 */

import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * Extensions the picker will accept. Keep in sync with file_parser.py.
 *
 * 'doc' and 'ppt' are deliberately here even though the backend refuses to
 * read them: letting the user pick a legacy file is what lets the server
 * reply with "save it as .docx" instead of the picker silently hiding the
 * file. They are intentionally absent from SUPPORTED_LABEL below, which is
 * what the UI advertises.
 */
export const ALLOWED_EXTENSIONS = [
  'pdf',
  'docx',
  'pptx',
  'doc',
  'ppt',
  'txt',
  'md',
  'markdown',
  'csv',
] as const;

/** Matches MAX_UPLOAD_BYTES in ai_assistant/views.py. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export interface PickedDocument {
  name: string;
  uri: string;
  size: number;
  mimeType: string | null;
}

export class UnsupportedFileError extends Error {}

export function extensionOf(name: string): string {
  const clean = (name || '').split('?')[0].trim().toLowerCase();
  const dot = clean.lastIndexOf('.');
  return dot === -1 ? '' : clean.slice(dot + 1);
}

/**
 * What the UI advertises. This is the single source of truth for every
 * "supported file types" string in the app — six hand-maintained copies had
 * drifted apart, and two of them still claimed "PDF or text file" after
 * DOCX/PPTX support shipped. Import this instead of retyping a list.
 */
export const SUPPORTED_LABEL = 'PDF, DOCX, PPTX, TXT, MD or CSV';

/**
 * Images accepted by the AI chat's vision path. Kept in sync with
 * `SUPPORTED_IMAGE_MIMES` in ai_assistant/views.py — the server rejects
 * anything else, so advertising more here would just produce a failed send.
 */
export const SUPPORTED_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'] as const;

export const IMAGE_MIMES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
};

export const SUPPORTED_IMAGE_LABEL = 'JPEG, PNG, WebP or HEIC';

export interface PickedImage {
  name: string;
  uri: string;
  size: number;
  mimeType: string;
}

function validateImage(asset: {
  name?: string | null;
  size?: number | null;
  mimeType?: string | null;
  uri: string;
}): PickedImage {
  const name = asset.name || 'photo.jpg';
  const ext = extensionOf(name);
  const mime = IMAGE_MIMES[ext];

  if (!mime) {
    throw new UnsupportedFileError(
      `"${name}" is not a supported image. Use ${SUPPORTED_IMAGE_LABEL}.`,
    );
  }

  const size = asset.size ?? 0;
  if (size > MAX_UPLOAD_BYTES) {
    throw new UnsupportedFileError(
      `"${name}" is ${(size / (1024 * 1024)).toFixed(1)} MB. The limit is 10 MB.`,
    );
  }

  return { name, uri: asset.uri, size, mimeType: mime };
}

/**
 * Open the photo library so a student can ask a question about a picture.
 * Separate from `pickDocument` because these go to a vision model, not the
 * text extractors — sending a JPEG down the document path returned mojibake.
 */
export async function pickImage(): Promise<PickedImage | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new UnsupportedFileError(
      'Photo access is off. Enable it in Settings to ask a question about a picture.',
    );
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    // Vision models do not need a huge image, and base64 bodies are sent as
    // JSON, so cap the long edge to keep uploads quick on mobile data.
    quality: 0.7,
    exif: false,
  });

  if (result.canceled) return null;

  const asset = result.assets?.[0];
  if (!asset) return null;

  // ImagePicker does not always populate `name`, and on Android the file name
  // is what tells the server the format when MIME is missing.
  const fileName = asset.fileName || `photo.${asset.mimeType?.split('/')[1] || 'jpg'}`;
  return validateImage({
    name: fileName,
    size: asset.fileSize ?? 0,
    mimeType: asset.mimeType ?? null,
    uri: asset.uri,
  });
}

export function isImageUri(nameOrUri: string): boolean {
  const ext = extensionOf(nameOrUri);
  return ext in IMAGE_MIMES;
}

function validate(asset: { name?: string | null; size?: number | null }): PickedDocument {
  const name = asset.name || 'file';
  const ext = extensionOf(name);

  if (!ext || !ALLOWED_EXTENSIONS.includes(ext as (typeof ALLOWED_EXTENSIONS)[number])) {
    throw new UnsupportedFileError(`"${name}" is not a supported file type. Use ${SUPPORTED_LABEL}.`);
  }

  const size = asset.size ?? 0;
  if (size > MAX_UPLOAD_BYTES) {
    throw new UnsupportedFileError(
      `"${name}" is ${(size / (1024 * 1024)).toFixed(1)} MB. The limit is 10 MB.`,
    );
  }

  return {
    name,
    uri: (asset as { uri: string }).uri,
    size,
    mimeType: (asset as { mimeType?: string | null }).mimeType ?? null,
  };
}

/**
 * Open the system document picker and return the chosen file, or null if the
 * user backed out. Throws UnsupportedFileError for anything we can't read.
 */
export async function pickDocument(): Promise<PickedDocument | null> {
  const result = await DocumentPicker.getDocumentAsync({
    // Ask for everything; the extension allowlist above is the real gate.
    type: '*/*',
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled) return null;

  const asset = result.assets?.[0];
  if (!asset) return null;

  return validate(asset);
}

/** Read a picked file as base64 for the JSON upload endpoints. */
export async function readAsBase64(uri: string): Promise<string> {
  return FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
}

/** Shape the upload endpoints expect. */
export interface UploadPayload {
  name: string;
  data: string;
}

export async function toUploadPayload(file: PickedDocument): Promise<UploadPayload> {
  return { name: file.name, data: await readAsBase64(file.uri) };
}

/** Turn any thrown value into something worth showing a student. */
export function describeFileError(error: unknown): string {
  if (error instanceof UnsupportedFileError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Could not read the selected file.';
}
