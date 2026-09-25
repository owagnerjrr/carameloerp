export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const body = await response
    .json()
    .catch(() => ({ message: "Resposta indisponível. Tente novamente." }));
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth/"))
      window.dispatchEvent(new Event("session-expired"));
    throw new ApiError(
      response.status,
      body.issues?.length
        ? `${body.message} ${body.issues.map((i: { field: string; message: string }) => `${i.field}: ${i.message}`).join("; ")}`
        : body.message,
    );
  }
  return body;
}
export const money = (value: string | number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(value),
  );
export const number = (value: string | number) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(
    Number(value),
  );
export const dateTime = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
export interface Auth {
  companyId: string;
  membershipId: string;
  name: string;
  email: string;
  companyName: string;
  role: string;
  permissions: string[];
}
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}
