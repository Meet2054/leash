import type { AssetAmount, Network, PaymentRequirements, Price, SchemeNetworkServer, SupportedKind } from "@x402/core/types";
import { KNOWN_ASSETS, LEASH_SCHEME } from "./scheme.js";

/**
 * x402 resource-server side of `leash-batch`: turns "$0.01" into atomic USDT and copies the facilitator's
 * advertised `extra` (facilitatorUrl, minChannel, factory) into the 402 requirements.
 */
export class LeashSchemeServer implements SchemeNetworkServer {
  readonly scheme = LEASH_SCHEME;
  readonly defaultAssetTransferMethod = "default";
  readonly paymentFlows = { default: { supported: ["authorization"] as const, default: "authorization" as const } };

  async parsePrice(price: Price, network: Network): Promise<AssetAmount> {
    if (typeof price === "object") return price;
    const known = KNOWN_ASSETS[network];
    if (!known) throw new Error(`leash-batch: no default asset for ${network}`);
    const s = String(price).trim().replace(/^\$/, "");
    if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`leash-batch: bad price ${price}`);
    const [whole, frac = ""] = s.split(".");
    if (frac.length > known.decimals) throw new Error(`leash-batch: price ${price} has too many decimals`);
    const amount = BigInt(whole) * 10n ** BigInt(known.decimals) + BigInt(frac.padEnd(known.decimals, "0") || "0");
    return { asset: known.asset, amount: amount.toString() };
  }

  getAssetDecimals(asset: string, network: Network): number | undefined {
    const known = KNOWN_ASSETS[network];
    return known && known.asset.toLowerCase() === asset.toLowerCase() ? known.decimals : undefined;
  }

  async enhancePaymentRequirements(
    req: PaymentRequirements,
    supportedKind: SupportedKind,
    _facilitatorExtensions: string[],
  ): Promise<PaymentRequirements> {
    return { ...req, extra: { ...(supportedKind.extra ?? {}), ...(req.extra ?? {}) } };
  }
}
