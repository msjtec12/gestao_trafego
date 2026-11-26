import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatCurrencyBrl(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatNumberPtBr(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(value);
}

export function formatPercentPtBr(value: number): string {
  return `${value.toFixed(2).replace(".", ",")}%`;
}
