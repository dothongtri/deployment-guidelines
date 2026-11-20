// Trình duyệt luôn gọi same-origin "/api". Next.js server sẽ proxy tiếp sang
// identity-service qua API_INTERNAL_URL (xem src/app/api/[...path]/route.ts).
//
// Không dùng NEXT_PUBLIC_API_BASE_URL nữa: biến NEXT_PUBLIC_* bị nhúng cứng vào
// bundle lúc build, nên đổi trong docker-compose lúc runtime không có tác dụng.
const API_PREFIX = "/api";

// ─── API envelope ─────────────────────────────────────────────────────────────

interface ApiResponse<T> {
  code: number;
  result: T;
  message?: string;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface LoginResult {
  token: string;
  authenticated: boolean;
}

export interface UserRole {
  name: string;
  description: string;
  permissions: string[];
}

export interface UserInfo {
  id: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  dob: string | null;
  roles: UserRole[];
}

export interface AuthServiceError {
  message: string;
  status?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function handleResponse<T>(res: Response): Promise<T> {
  let body: ApiResponse<T> | undefined;
  try {
    body = await res.json();
  } catch {
    // non-JSON body
  }

  if (!res.ok) {
    const message = body?.message ?? `Request failed with status ${res.status}`;
    const err: AuthServiceError = { message, status: res.status };
    throw err;
  }

  if (!body || body.code !== 1000) {
    const err: AuthServiceError = {
      message: body?.message ?? "Unexpected response from server.",
      status: res.status,
    };
    throw err;
  }

  return body.result;
}

// ─── Auth API ─────────────────────────────────────────────────────────────────

/**
 * POST /identity/auth/token
 * Authenticates a user and returns an access token.
 */
export async function login(
  credentials: LoginCredentials,
): Promise<LoginResult> {
  const res = await fetch(`${API_PREFIX}/identity/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  });

  return handleResponse<LoginResult>(res);
}

/**
 * GET /identity/users/my-info
 * Returns the currently authenticated user's profile.
 */
export async function getMyInfo(token: string): Promise<UserInfo> {
  const res = await fetch(`${API_PREFIX}/identity/users/my-info`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  return handleResponse<UserInfo>(res);
}
