import { useRef } from "react";
import { api } from "../api";
export type Book = {
  id: string;
  description: string;
  isbn13: string | null;
  author: string | null;
  publisher: string | null;
  cost: string;
};
export type Options = {
  branches: { id: string; name: string }[];
  warehouses: { id: string; name: string; branchId: string }[];
  suppliers: { id: string; name: string }[];
  buyers: { id: string; branchId: string | null; user: { name: string } }[];
};
export type OrderItem = {
  id: string;
  productId: string;
  title: string;
  isbn: string | null;
  author: string | null;
  publisher: string | null;
  quantity: number;
  receivedQuantity: number;
  unitCost: string;
  unitDiscount: string;
  subtotal: string;
};
export type Purchase = {
  id: string;
  number: number;
  status: string;
  branchId: string;
  supplierId: string;
  buyerId: string;
  orderedAt: string;
  expectedAt: string | null;
  notes: string | null;
  freight: string;
  expenses: string;
  subtotal: string;
  discount: string;
  total: string;
  supplier: { name: string };
  branch: { name: string };
  buyer: { user: { name: string } };
  items: OrderItem[];
  actions: {
    id: string;
    kind: string;
    notes: string;
    createdAt: string;
    actor: { user: { name: string } };
  }[];
  receipts: {
    id: string;
    total: string;
    createdAt: string;
    document: {
      receivedAt: string;
      notes: string;
      warehouse: { name: string };
      actor: { user: { name: string } };
    };
    items: {
      id: string;
      quantity: number;
      unitCost: string;
      allocatedCharges: string;
      resultingCost: string;
      orderItem: OrderItem;
    }[];
    divergences: {
      id: string;
      type: string;
      quantity: number;
      notes: string;
      product: { description: string };
    }[];
  }[];
};
/** A failed request retains its key; changing payload creates a new operation. */
export function usePurchaseRequest() {
  const request = useRef({ signature: "", key: "" });
  return async <T,>(path: string, payload: object, method = "POST") => {
    const signature = JSON.stringify({ path, method, payload });
    if (signature !== request.current.signature)
      request.current = { signature, key: crypto.randomUUID() };
    return api<T>(path, {
      method,
      body: JSON.stringify({ ...payload, requestKey: request.current.key }),
    });
  };
}
export const purchaseActionNames: Record<string, string> = {
  PURCHASE_ORDER_CREATED: "Criado",
  PURCHASE_ORDER_UPDATED: "Alterado",
  PURCHASE_ORDER_SUBMITTED: "Solicitada aprovação",
  PURCHASE_ORDER_APPROVED: "Aprovado",
  PURCHASE_ORDER_ORDERED: "Enviado ao fornecedor",
  PURCHASE_ORDER_CANCELLED: "Saldo cancelado",
  PURCHASE_RECEIVED: "Conferência registrada",
};
export function cents(value: string) {
  return /^\d+(\.\d{0,2})?$/.test(value)
    ? BigInt(value.split(".")[0]!) * 100n +
        BigInt((value.split(".")[1] ?? "").padEnd(2, "0"))
    : 0n;
}
export function decimal(value: bigint) {
  const sign = value < 0n ? "-" : "";
  const n = value < 0n ? -value : value;
  return `${sign}${n / 100n}.${String(n % 100n).padStart(2, "0")}`;
}
