  // hooks/api.ts
  // Centralized API helper for the mobile app
  import { notifyUnauthorized } from '@/auth/session-expired';

  const API_URL = process.env.EXPO_PUBLIC_API_URL;

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
    const headers: Record<string, string> = {
      ...(fetchOpts.headers as Record<string, string>),
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    if (!headers['Content-Type'] && !(fetchOpts.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(`${API_URL}${path}`, { ...fetchOpts, headers });
    if (!res.ok) {
      if (res.status === 401 && token) {
        notifyUnauthorized();
      }
      const err = await res.json().catch(() => ({}));
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
      // Web requires a Blob/File instance; native accepts { uri, name, type }.
      if (file.webFile) {
        form.append('files', file.webFile, file.name);
      } else {
        form.append('files', {
          uri: file.uri,
          name: file.name,
          type: file.type,
        } as any);
      }
    }

    if (additionalFields) {
      for (const [key, value] of Object.entries(additionalFields)) {
        form.append(key, value);
      }
    }

    const res = await fetch(`${API_URL}${path}`, {
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
    if (file.webFile) {
      form.append('file', file.webFile, file.name);
    } else {
      form.append('file', {
        uri: file.uri,
        name: file.name,
        type: file.type,
      } as any);
    }

    const res = await fetch(`${API_URL}${path}`, {
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
