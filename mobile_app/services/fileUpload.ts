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
import * as FileSystem from 'expo-file-system/legacy';

/** Extensions the backend can actually read. Keep in sync with file_parser.py. */
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

/** Human-readable list for the rejection message. */
const ALLOWED_LABEL = 'PDF, DOCX, PPTX, DOC, PPT, TXT, MD, CSV';

function validate(asset: { name?: string | null; size?: number | null }): PickedDocument {
  const name = asset.name || 'file';
  const ext = extensionOf(name);

  if (!ext || !ALLOWED_EXTENSIONS.includes(ext as (typeof ALLOWED_EXTENSIONS)[number])) {
    throw new UnsupportedFileError(`"${name}" is not a supported file type. Use ${ALLOWED_LABEL}.`);
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
