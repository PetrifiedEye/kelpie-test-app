import type { ImportReport, JobSnapshot } from "./operation-machine";

export type ByteSource =
  { kind: "bytes"; bytes: Uint8Array } | { kind: "file"; uri: string };

export type HttpResult = { status: number; body: string };

export type ImportTransport = {
  postOctetStream(input: {
    url: string;
    headers: Record<string, string>;
    source: ByteSource;
  }): Promise<HttpResult>;
  request(input: {
    url: string;
    method: "GET" | "DELETE";
    headers?: Record<string, string>;
  }): Promise<HttpResult>;
};

export type ImportFailureCode =
  | "network"
  | "conflict"
  | "too_large"
  | "unsupported"
  | "not_found"
  | "unavailable"
  | "invalid";

export class ImportRequestError extends Error {
  readonly code: ImportFailureCode;
  readonly status: number | null;

  constructor(
    code: ImportFailureCode,
    message: string,
    status: number | null = null,
  ) {
    super(message);
    this.name = "ImportRequestError";
    this.code = code;
    this.status = status;
  }
}

const JOB_STATUSES = new Set([
  "queued",
  "processing",
  "ready",
  "deleting",
  "deleted",
]);

export function fileNameHeader(fileName: string): string {
  const trimmed = fileName.trim().slice(0, 255);
  if (trimmed.length === 0) return "statement";
  if (/^[\x20-\x7E]+$/.test(trimmed)) return trimmed;
  return encodeURIComponent(trimmed).slice(0, 255);
}

export function createFetchTransport(): ImportTransport {
  return {
    async postOctetStream({ url, headers, source }) {
      if (source.kind !== "bytes") {
        throw new ImportRequestError(
          "invalid",
          "This transport can only send prepared bytes.",
        );
      }
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/octet-stream",
          },
          body: octetBody(source.bytes),
        });
        return { status: response.status, body: await response.text() };
      } catch (error) {
        throw asNetworkError(error);
      }
    },
    async request({ url, method, headers }) {
      try {
        const response = await fetch(url, { method, headers });
        return { status: response.status, body: await response.text() };
      } catch (error) {
        throw asNetworkError(error);
      }
    },
  };
}

export type ImportApi = {
  createImport(input: {
    importKey: string;
    fileName: string;
    source: ByteSource;
  }): Promise<JobSnapshot>;
  getByKey(importKey: string): Promise<JobSnapshot>;
  getJob(jobId: string): Promise<JobSnapshot>;
  deleteImport(jobId: string, deleteKey: string): Promise<JobSnapshot>;
};

export function createImportApi(
  baseUrl: string,
  transport: ImportTransport,
): ImportApi {
  const root = baseUrl.replace(/\/$/, "");
  return {
    createImport({ importKey, fileName, source }) {
      return interpret(
        transport.postOctetStream({
          url: `${root}/imports`,
          headers: {
            "Idempotency-Key": importKey,
            "X-File-Name": fileNameHeader(fileName),
          },
          source,
        }),
        [202],
      );
    },
    getByKey(importKey) {
      return interpret(
        transport.request({
          url: `${root}/imports/by-key/${encodeURIComponent(importKey)}`,
          method: "GET",
        }),
        [200],
      );
    },
    getJob(jobId) {
      return interpret(
        transport.request({
          url: `${root}/imports/${encodeURIComponent(jobId)}`,
          method: "GET",
        }),
        [200],
      );
    },
    deleteImport(jobId, deleteKey) {
      return interpret(
        transport.request({
          url: `${root}/imports/${encodeURIComponent(jobId)}`,
          method: "DELETE",
          headers: { "Idempotency-Key": deleteKey },
        }),
        [202],
      );
    },
  };
}

async function interpret(
  pending: Promise<HttpResult>,
  accept: number[],
): Promise<JobSnapshot> {
  let result: HttpResult;
  try {
    result = await pending;
  } catch (error) {
    if (error instanceof ImportRequestError) throw error;
    throw new ImportRequestError(
      "network",
      "The network request did not finish.",
    );
  }
  if (result.status === 0) {
    throw new ImportRequestError(
      "network",
      "The network request did not finish.",
      0,
    );
  }
  if (!accept.includes(result.status)) throw errorForStatus(result.status);
  return parseJob(result.body);
}

function errorForStatus(status: number): ImportRequestError {
  switch (status) {
    case 409:
      return new ImportRequestError(
        "conflict",
        "This upload key was already used for a different file.",
        409,
      );
    case 413:
      return new ImportRequestError(
        "too_large",
        "The file is larger than 10 MB.",
        413,
      );
    case 415:
      return new ImportRequestError(
        "unsupported",
        "The server rejected the file contents.",
        415,
      );
    case 404:
      return new ImportRequestError(
        "not_found",
        "No server job was found for this upload.",
        404,
      );
    case 503:
      return new ImportRequestError(
        "unavailable",
        "Deletion was not accepted. The report is still available.",
        503,
      );
    default:
      return new ImportRequestError(
        "invalid",
        "The server could not accept the request.",
        status,
      );
  }
}

function parseJob(body: string): JobSnapshot {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new ImportRequestError(
      "invalid",
      "The server returned an unreadable job.",
    );
  }
  if (!value || typeof value !== "object") {
    throw new ImportRequestError(
      "invalid",
      "The server returned an unreadable job.",
    );
  }
  const job = value as {
    jobId?: unknown;
    status?: unknown;
    revision?: unknown;
    currency?: unknown;
    items?: unknown;
  };
  if (
    typeof job.jobId !== "string" ||
    typeof job.revision !== "number" ||
    typeof job.status !== "string"
  ) {
    throw new ImportRequestError(
      "invalid",
      "The server returned an unreadable job.",
    );
  }
  if (!JOB_STATUSES.has(job.status)) {
    throw new ImportRequestError(
      "invalid",
      "The server returned an unknown job status.",
    );
  }
  return {
    jobId: job.jobId,
    status: job.status as JobSnapshot["status"],
    revision: job.revision,
    report: parseReport(job.currency, job.items),
  };
}

function parseReport(currency: unknown, items: unknown): ImportReport | null {
  if (typeof currency !== "string" || !Array.isArray(items)) return null;
  const charges: ImportReport["items"] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") return null;
    const charge = item as Partial<ImportReport["items"][number]>;
    if (
      typeof charge.id !== "string" ||
      typeof charge.merchant !== "string" ||
      typeof charge.amountMinor !== "number" ||
      typeof charge.cadence !== "string" ||
      typeof charge.lastSeen !== "string"
    ) {
      return null;
    }
    charges.push({
      id: charge.id,
      merchant: charge.merchant,
      amountMinor: charge.amountMinor,
      cadence: charge.cadence,
      lastSeen: charge.lastSeen,
    });
  }
  return { currency, items: charges };
}

function octetBody(bytes: Uint8Array): BodyInit {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy]);
}

function asNetworkError(error: unknown): ImportRequestError {
  if (error instanceof ImportRequestError) return error;
  return new ImportRequestError(
    "network",
    "The network request did not finish.",
  );
}
