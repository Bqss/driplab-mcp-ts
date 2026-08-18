/**
 * Money formatting per product currency.
 * Wajom = MYR (Ringgit), Dripsender = IDR (Rupiah).
 */

export type Currency = "MYR" | "IDR";

const SYMBOL: Record<Currency, string> = { MYR: "RM", IDR: "Rp" };

export function formatMoney(
  amount: number | null | undefined,
  currency: Currency
): string | null {
  if (amount === null || amount === undefined) return null;
  const sym = SYMBOL[currency];
  if (currency === "IDR") {
    return `${sym} ${Math.round(amount).toLocaleString()}`;
  }
  return Number.isInteger(amount)
    ? `${sym} ${amount.toLocaleString()}`
    : `${sym} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
