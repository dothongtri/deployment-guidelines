import type { NextRequest } from "next/server";

// Proxy mọi request "/api/*" sang identity-service.
//
// Lý do: trình duyệt không resolve được tên Docker nội bộ (vd: "identity-service"),
// còn biến NEXT_PUBLIC_* bị nhúng cứng vào bundle lúc build. Vì vậy browser chỉ gọi
// same-origin "/api/*", rồi Next.js server (nằm trong cùng Docker network) mới gọi
// sang API_INTERNAL_URL — biến này đọc lúc runtime nên đổi không cần rebuild.
//
// Ví dụ: POST /api/identity/auth/token
//        -> POST ${API_INTERNAL_URL}/identity/auth/token
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_API_INTERNAL_URL = "http://localhost:8080";

// Header chỉ có ý nghĩa cho đúng một kết nối, không được forward tiếp.
const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

function getInternalBaseUrl(): string {
  return (process.env.API_INTERNAL_URL ?? DEFAULT_API_INTERNAL_URL).replace(
    /\/+$/,
    "",
  );
}

async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await context.params;

  const targetUrl = `${getInternalBaseUrl()}/${path
    .map(encodeURIComponent)
    .join("/")}${request.nextUrl.search}`;

  const headers = new Headers(request.headers);
  for (const name of HOP_BY_HOP_HEADERS) {
    headers.delete(name);
  }
  // fetch tự xử lý nén/độ dài; để nguyên sẽ làm lệch body khi trả về.
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("accept-encoding");
  // undici (fetch của Node) không hỗ trợ header này -> "expect header not supported".
  headers.delete("expect");

  // Giữ thông tin client gốc cho identity-service (log, rate limit...).
  headers.set("x-forwarded-host", request.headers.get("host") ?? "");
  headers.set("x-forwarded-proto", request.nextUrl.protocol.replace(/:$/, ""));

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
    cache: "no-store",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, init);
  } catch (error) {
    console.error(`[api-proxy] ${request.method} ${targetUrl} failed:`, error);
    return Response.json(
      {
        code: 5000,
        message: "Cannot reach identity-service. Check API_INTERNAL_URL.",
      },
      { status: 502 },
    );
  }

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  responseHeaders.delete("transfer-encoding");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
