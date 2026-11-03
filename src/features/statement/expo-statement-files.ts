import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, FileMode, Paths } from 'expo-file-system';

import type { CacheCopy, OpenedStatement, StatementFiles } from './stage-statement';
import { isOwnedStatementCopy, isPickerTemporaryCopy } from './statement-policy';

const CACHE_DIRECTORY_NAME = 'statement-imports';

function cacheDirectory(): Directory {
  const directory = new Directory(Paths.cache, CACHE_DIRECTORY_NAME);
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  return directory;
}

function closeQuiet(handle: { close: () => void }): void {
  try {
    handle.close();
  } catch {
    // The descriptor is already closed.
  }
}

function releasePickerTemporaryCopy(source: File): void {
  if (!isPickerTemporaryCopy(source.uri)) return;
  if (isOwnedStatementCopy(source.uri, cacheDirectory().uri)) return;
  try {
    if (source.exists) source.delete();
  } catch {
    // The temporary picker copy may already be gone.
  }
}

export function deleteCachedStatement(uri: string): void {
  const directory = cacheDirectory();
  if (!isOwnedStatementCopy(uri, directory.uri)) return;
  const file = new File(uri);
  if (file.exists) file.delete();
}

function openPickedFile(uri: string, fileName: string): OpenedStatement {
  const source = new File(uri);
  const handle = source.open(FileMode.ReadOnly);
  return {
    fileName: fileName || source.name || 'statement',
    read: (length) => handle.readBytes(length),
    close: () => closeQuiet(handle),
    releaseSource: () => releasePickerTemporaryCopy(source),
  };
}

export function createExpoStatementFiles(): StatementFiles {
  return {
    async pick() {
      const selected = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        multiple: false,
        copyToCacheDirectory: false,
      });
      if (selected.canceled || !selected.assets[0]) return null;
      const asset = selected.assets[0];
      return openPickedFile(asset.uri, asset.name);
    },
    beginCopy(): CacheCopy {
      const destination = new File(cacheDirectory(), `${Crypto.randomUUID()}.statement`);
      destination.create({ intermediates: true });
      const handle = destination.open(FileMode.WriteOnly);
      return {
        path: destination.uri,
        write: (bytes) => handle.writeBytes(bytes),
        close: () => closeQuiet(handle),
        delete: () => {
          closeQuiet(handle);
          if (destination.exists) destination.delete();
        },
      };
    },
  };
}
