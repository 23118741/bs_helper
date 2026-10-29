/**
 * server/src/pricing.ts
 * Converts token usage into micro-euro (1 EUR = 1,000,000 micro-EUR, stored as integers).
 * Prices are USD per 1M tokens, taken from the providers' pricing pages on 2026-10-21.
 * They change: re-check before launch and override with PRICE_IN_USD_PER_M / PRICE_OUT_USD_PER_M.
 */

import type { Config } from './config.js';

export interface ModelPrice {
  inUsdPerM: number;
  outUsdPerM: number;
  /** Prompts above this many tokens are billed at the "long" rates (e.g. Claude Haiku 5.5: 100k). */
  longPromptThreshold?: number;
  longInUsdPerM?: number;
  longOutUsdPerM?: number;
}

export const PRICE_TABLE: Record<string, ModelPrice> = {
  'gemini-3.1-flash-lite': { inUsdPerM: 0.25, outUsdPerM: 1.5 },
  'gemini-3.5-flash-lite': { inUsdPerM: 0.3, outUsdPerM: 2.5 },
  // Introductory price until 2026-12-31; $1.50 / $7.50 from 2027-01-01.
  'gemini-3.8-flash': { inUsdPerM: 0.75, outUsdPerM: 3.75 },
  'claude-haiku-5-5': {
    inUsdPerM: 0.1,
    outUsdPerM: 0.5,
    longPromptThreshold: 100_000,
    longInUsdPerM: 0.5,
    longOutUsdPerM: 2.5,
  },
  'mistral-small-latest': { inUsdPerM: 0.15, outUsdPerM: 0.6 },
  'fake-model': { inUsdPerM: 0.25, outUsdPerM: 1.5 },
};

export class Pricing {
  private readonly price: ModelPrice;

  constructor(private readonly config: Pick<Config, 'model' | 'usdToEur' | 'priceInUsdPerM' | 'priceOutUsdPerM'>) {
    if (config.priceInUsdPerM !== undefined && config.priceOutUsdPerM !== undefined) {
      this.price = { inUsdPerM: config.priceInUsdPerM, outUsdPerM: config.priceOutUsdPerM };
    } else if (PRICE_TABLE[config.model]) {
      this.price = PRICE_TABLE[config.model];
    } else {
      // Fail closed: without a price the cost limits would be meaningless.
      throw new Error(
        `No price known for model "${config.model}". Set PRICE_IN_USD_PER_M and PRICE_OUT_USD_PER_M.`
      );
    }
  }

  /** Cost in micro-EUR: tokens × (USD per 1M tokens) × (EUR per USD), rounded up. */
  costMicroEur(inputTokens: number, outputTokens: number): number {
    const p = this.price;
    const long = p.longPromptThreshold !== undefined && inputTokens > p.longPromptThreshold;
    const inRate = long ? (p.longInUsdPerM ?? p.inUsdPerM) : p.inUsdPerM;
    const outRate = long ? (p.longOutUsdPerM ?? p.outUsdPerM) : p.outUsdPerM;
    return Math.ceil((inputTokens * inRate + outputTokens * outRate) * this.config.usdToEur);
  }
}

export const microToEur = (micro: number): number => Math.round(micro) / 1_000_000;
export const eurToMicro = (eur: number): number => Math.round(eur * 1_000_000);
