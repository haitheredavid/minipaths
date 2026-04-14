export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function handleResponse(res: Response) {
  const data = await res.json();
  if (!res.ok) {
    throw new ApiError(data.error ?? "Request failed", res.status);
  }
  return data;
}

export async function apiPost(path: string, body?: unknown) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: body ? JSON.stringify(body) : undefined,
  });
  return handleResponse(res);
}

export async function apiGet(path: string) {
  const res = await fetch(path, { credentials: "same-origin" });
  return handleResponse(res);
}
