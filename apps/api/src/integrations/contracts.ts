/** Contracts only. No provider is configured or called in this delivery. */
export interface IntegrationContext {
  companyId: string;
  idempotencyKey: string;
}
export interface FiscalProvider {
  submit(
    context: IntegrationContext,
    document: { id: string; type: "NFE" | "NFCE" | "NFSE" | "CTE" | "MDFE" },
  ): Promise<{
    reference: string;
    status: "PROCESSING" | "AUTHORIZED" | "REJECTED";
  }>;
  status(
    context: IntegrationContext,
    reference: string,
  ): Promise<{ status: string }>;
  cancel(
    context: IntegrationContext,
    reference: string,
    reason: string,
  ): Promise<void>;
}
export interface PaymentProvider {
  createCharge(
    context: IntegrationContext,
    input: { amount: string; method: "PIX" | "BANK_SLIP"; dueDate: string },
  ): Promise<{ reference: string; paymentUrl?: string }>;
}
export interface MessagingProvider {
  send(
    context: IntegrationContext,
    input: {
      recipient: string;
      templateId: string;
      parameters: Record<string, string>;
    },
  ): Promise<{ reference: string }>;
}
export interface CommerceProvider {
  syncProduct(context: IntegrationContext, productId: string): Promise<void>;
}
export interface AccountingProvider {
  exportPeriod(
    context: IntegrationContext,
    from: string,
    to: string,
  ): Promise<{ reference: string }>;
}
