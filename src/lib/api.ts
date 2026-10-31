import type { ApiErrorBody } from "../../shared/contracts";

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: Record<string, string>;

  constructor(
    status: number,
    code: string,
    message: string,
    fieldErrors: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

async function parseResponse<T>(response: Response, path: string): Promise<T> {
  const body = (
    response.status === 204 ? null : await response.json().catch(() => null)
  ) as (T & Partial<ApiErrorBody>) | null;

  if (!response.ok) {
    if (
      response.status === 401 &&
      typeof window !== "undefined" &&
      !path.includes("/guest") &&
      !["/api/auth/login", "/api/auth/register", "/api/auth/session", "/api/setup/status"].includes(
        path.split("?")[0],
      )
    ) {
      window.dispatchEvent(new Event("civicsignal:session-expired"));
    }
    const error = body?.error;
    const fieldErrors: Record<string, string> = {};
    for (const [field, messages] of Object.entries(error?.fieldErrors ?? {})) {
      fieldErrors[field] = messages[0] ?? "Invalid value.";
    }
    throw new ApiRequestError(
      response.status,
      error?.code ?? "REQUEST_FAILED",
      error?.message ?? "Something went wrong. Please try again.",
      fieldErrors,
    );
  }

  return (body ?? {}) as T;
}

function request<T>(path: string, init?: RequestInit): Promise<T> {
  return fetch(path, { credentials: "same-origin", ...init }).then((response) =>
    parseResponse<T>(response, path),
  );
}

export function errorDetails(error: unknown): {
  message: string;
  fieldErrors: Record<string, string>;
} {
  if (error instanceof ApiRequestError) {
    return { message: error.message, fieldErrors: error.fieldErrors };
  }
  return { message: "Something went wrong. Please try again.", fieldErrors: {} };
}

export const api = {
  get<T>(path: string): Promise<T> {
    return request<T>(path);
  },
  getWithGuestAccess<T>(path: string, token: string): Promise<T> {
    return request<T>(path, { headers: { "X-Guest-Access": token } });
  },
  postWithGuestAccess<T>(path: string, token: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: "POST",
      headers: {
        "X-Guest-Access": token,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  },
  postGuestConfirm<T>(path: string, token: string): Promise<T> {
    return request<T>(path, {
      method: "POST",
      headers: { "X-Guest-Access": token },
    });
  },
  getGuestPhoto(path: string, token: string): Promise<Blob> {
    return fetch(path, {
      credentials: "same-origin",
      headers: { "X-Guest-Access": token },
    }).then(async (response) => {
      if (!response.ok) {
        const body = await response.json().catch(() => null) as Partial<ApiErrorBody> | null;
        throw new ApiRequestError(
          response.status,
          body?.error?.code ?? "REQUEST_FAILED",
          body?.error?.message ?? "This photo is unavailable.",
        );
      }
      return response.blob();
    });
  },
  post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  },
  patch<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: "PATCH",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  },
  put<T>(path: string, body?: unknown): Promise<T> {
    return request(path, {
      method: "PUT",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  },
  delete<T>(path: string, body?: unknown): Promise<T> {
    return request(path, {
      method: "DELETE",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  },
  postForm<T>(path: string, form: FormData): Promise<T> {
    return request<T>(path, { method: "POST", body: form });
  },
};
