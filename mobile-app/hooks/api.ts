  // hooks/api.ts
  // Centralized API helper for the mobile app
  import { notifyUnauthorized } from '@/auth/session-expired';
  import { API_BASE_URL } from '@/constants/api';

  type FetchOptions = RequestInit & {
    token?: string;
  };

  /**
   * Make an authenticated API request.
   */
  export async function apiFetch<T = any>(
    path: string,
    options: FetchOptions = {},
  ): Promise<T> {
    const { token, ...fetchOpts } = options;
    const debugUnsubmit = path.includes('/unsubmit');
    const headers: Record<string, string> = {
      ...(fetchOpts.headers as Record<string, string>),
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    if (!headers['Content-Type'] && !(fetchOpts.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    if (debugUnsubmit) {
      console.log('[UnsubmitDebug][apiFetch] request', {
        url: `${API_BASE_URL}${path}`,
        method: fetchOpts.method ?? 'GET',
        hasToken: Boolean(token),
      });
    }

    const res = await fetch(`${API_BASE_URL}${path}`, { ...fetchOpts, headers });
    if (debugUnsubmit) {
      console.log('[UnsubmitDebug][apiFetch] response', {
        status: res.status,
        ok: res.ok,
      });
    }
    if (!res.ok) {
      if (res.status === 401 && token) {
        notifyUnauthorized();
      }
      const err = await res.json().catch(() => ({}));
      if (debugUnsubmit) {
        console.log('[UnsubmitDebug][apiFetch] error body', err);
      }
      throw new Error(err.detail || `Request failed (${res.status})`);
    }
    return res.json();
  }

  export type UploadableFile = {
    uri: string;
    name: string;
    type: string;
    webFile?: Blob;
  };

  const appendUploadableFile = async (
    form: FormData,
    fieldName: string,
    file: UploadableFile,
  ) => {
    if (file.webFile) {
      form.append(fieldName, file.webFile, file.name);
      return;
    }

    if (typeof window !== 'undefined' && /^(blob:|data:|https?:)/.test(file.uri)) {
      const blob = await fetch(file.uri).then((res) => res.blob());
      form.append(fieldName, blob, file.name);
      return;
    }

    form.append(fieldName, {
      uri: file.uri,
      name: file.name,
      type: file.type,
    } as any);
  };

  const resolveApiError = (err: any, fallback: string): string => {
    if (typeof err?.detail === 'string') return err.detail;
    if (Array.isArray(err?.detail)) {
      return err.detail
        .map((item: any) => item?.msg || JSON.stringify(item))
        .join('; ');
    }
    return fallback;
  };

  /**
   * Upload files via multipart/form-data.
   */
  export async function apiUpload<T = any>(
    path: string,
    files: UploadableFile[],
    token: string,
    additionalFields?: Record<string, string>,
  ): Promise<T> {
    const form = new FormData();

    for (const file of files) {
      await appendUploadableFile(form, 'files', file);
    }

    if (additionalFields) {
      for (const [key, value] of Object.entries(additionalFields)) {
        form.append(key, value);
      }
    }

    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: form,
    });

    if (!res.ok) {
      if (res.status === 401) notifyUnauthorized();
      const err = await res.json().catch(() => ({}));
      throw new Error(resolveApiError(err, `Upload failed (${res.status})`));
    }
    return res.json();
  }

  /**
   * Upload a single file (for lesson/classwork attachment).
   */
  export async function apiUploadSingle<T = any>(
    path: string,
    file: UploadableFile,
    token: string,
  ): Promise<T> {
    const form = new FormData();
    await appendUploadableFile(form, 'file', file);

    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: form,
    });

    if (!res.ok) {
      if (res.status === 401) notifyUnauthorized();
      const err = await res.json().catch(() => ({}));
      throw new Error(resolveApiError(err, `Upload failed (${res.status})`));
    }
    return res.json();
  }
