// Schlanker Payrexx-Client fuer das monatliche CHF-1.-Abo (Gateway-API + Transaction-Abfrage).
// Authentifizierung per X-API-KEY-Header (siehe Payrexx-Doku "Authentication - X-API-KEY"),
// dadurch entfaellt die manuelle HMAC-Signaturberechnung.
const PAYREXX_API_BASE = "https://api.payrexx.com/v1.0";
export const SUBSCRIPTION_AMOUNT_CENTS = 100; // CHF 1.00
export const SUBSCRIPTION_CURRENCY = "CHF";

function getConfig() {
  const instance = process.env.PAYREXX_INSTANCE;
  const apiSecret = process.env.PAYREXX_API_SECRET;
  if (!instance || !apiSecret) {
    throw new Error("PAYREXX_INSTANCE / PAYREXX_API_SECRET sind nicht gesetzt. Bitte .env anlegen (siehe .env.example).");
  }
  return { instance, apiSecret };
}

async function payrexxRequest(method, path, params) {
  const { instance, apiSecret } = getConfig();
  const url = `${PAYREXX_API_BASE}${path}?instance=${encodeURIComponent(instance)}`;
  const options = { method, headers: { "X-API-KEY": apiSecret } };
  if (params && method !== "GET") {
    options.headers["Content-Type"] = "application/x-www-form-urlencoded";
    options.body = new URLSearchParams(params).toString();
  }
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.status === "error") {
    throw new Error(data.message || `Payrexx Fehler (Status ${response.status})`);
  }
  return data.data?.[0];
}

// Erstellt ein Payrexx-Gateway fuer die monatliche Abo-Zahlung (CHF 1.-, erneuert sich
// automatisch jeden Monat, bis der Nutzer im Payrexx-Kundenportal kuendigt).
export async function createSubscriptionGateway({ referenceId, successUrl, failedUrl, cancelUrl }) {
  return payrexxRequest("POST", "/Gateway/", {
    amount: String(SUBSCRIPTION_AMOUNT_CENTS),
    currency: SUBSCRIPTION_CURRENCY,
    purpose: "Matheapp Abo (CHF 1.-/Monat)",
    referenceId,
    successRedirectUrl: successUrl,
    failedRedirectUrl: failedUrl,
    cancelRedirectUrl: cancelUrl,
    subscriptionState: "true",
    subscriptionInterval: "P1M",
    subscriptionPeriod: "P1M",
  });
}

// Fragt eine Transaktion serverseitig erneut ab - dem Webhook-Payload selbst darf man nicht
// vertrauen (koennte gefaelscht sein), erst der per API-Key authentifizierte Re-Fetch ist sicher.
export async function retrieveTransaction(transactionId) {
  return payrexxRequest("GET", `/Transaction/${encodeURIComponent(transactionId)}/`);
}
