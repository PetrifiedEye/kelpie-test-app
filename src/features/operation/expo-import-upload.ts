import { File, UploadType } from 'expo-file-system';

import { createFetchTransport, ImportRequestError, type ImportTransport } from './imports-api';

export function createExpoImportTransport(): ImportTransport {
  const fetchTransport = createFetchTransport();
  return {
    async postOctetStream({ url, headers, source }) {
      if (source.kind === 'bytes') return fetchTransport.postOctetStream({ url, headers, source });
      try {
        const result = await new File(source.uri).upload(url, {
          httpMethod: 'POST',
          uploadType: UploadType.BINARY_CONTENT,
          mimeType: 'application/octet-stream',
          headers: {
            ...headers,
            'Content-Type': 'application/octet-stream',
          },
        });
        return { status: result.status, body: result.body ?? '' };
      } catch (error) {
        if (error instanceof ImportRequestError) throw error;
        throw new ImportRequestError('network', 'The network request did not finish.');
      }
    },
    request: (input) => fetchTransport.request(input),
  };
}
