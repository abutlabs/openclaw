import fs from "node:fs";
import type { OpenClawConfig } from "../config/config.js";
import type { FeishuAccountConfig } from "../config/types.feishu.js";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "../routing/session-key.js";

/**
 * Source of the Feishu app secret token.
 * - "config": From OpenClaw configuration file
 * - "file": From external file specified in config
 * - "env": From environment variables
 * - "none": No valid token source found
 */
export type FeishuTokenSource = "config" | "file" | "env" | "none";

/**
 * A fully resolved Feishu account with all configuration merged and validated.
 */
export type ResolvedFeishuAccount = {
  /** Normalized account identifier */
  accountId: string;
  /** Complete configuration for this account */
  config: FeishuAccountConfig;
  /** Where the app secret was sourced from */
  tokenSource: FeishuTokenSource;
  /** Human-readable name for the account */
  name?: string;
  /** Whether this account is enabled and ready to use */
  enabled: boolean;
};

/**
 * Safely reads a file and returns its content as a trimmed string.
 * Returns undefined if the file path is not provided or the file cannot be read.
 * 
 * @param filePath - Path to the file to read
 * @returns File content as trimmed string, or undefined if not readable
 */
function readFileIfExists(filePath?: string): string | undefined {
  if (!filePath) {
    return undefined;
  }
  try {
    return fs.readFileSync(filePath, "utf-8").trim();
  } catch {
    return undefined;
  }
}

/**
 * Resolves the specific account configuration from the global config.
 * Handles both exact matches and normalized account ID matching.
 * 
 * @param cfg - The complete OpenClaw configuration
 * @param accountId - The account ID to look up
 * @returns Account-specific configuration or undefined if not found
 */
function resolveAccountConfig(
  cfg: OpenClawConfig,
  accountId: string,
): FeishuAccountConfig | undefined {
  const accounts = cfg.channels?.feishu?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return undefined;
  }
  const direct = accounts[accountId] as FeishuAccountConfig | undefined;
  if (direct) {
    return direct;
  }
  const normalized = normalizeAccountId(accountId);
  const matchKey = Object.keys(accounts).find((key) => normalizeAccountId(key) === normalized);
  return matchKey ? (accounts[matchKey] as FeishuAccountConfig | undefined) : undefined;
}

/**
 * Merges base Feishu configuration with account-specific overrides.
 * Account-specific settings take precedence over base configuration.
 * 
 * @param cfg - The complete OpenClaw configuration
 * @param accountId - The account ID to merge configuration for
 * @returns Merged configuration with account overrides applied
 */
function mergeFeishuAccountConfig(cfg: OpenClawConfig, accountId: string): FeishuAccountConfig {
  const { accounts: _ignored, ...base } = (cfg.channels?.feishu ?? {}) as FeishuAccountConfig & {
    accounts?: unknown;
  };
  const account = resolveAccountConfig(cfg, accountId) ?? {};
  return { ...base, ...account };
}

/**
 * Resolves the Feishu app secret from configuration or external file.
 * Prioritizes direct configuration over file-based secrets.
 * Does not check environment variables (handled separately).
 * 
 * @param config - Configuration object with app secret settings
 * @returns Object with resolved secret value and its source, or empty if not found
 */
function resolveAppSecret(config?: { appSecret?: string; appSecretFile?: string }): {
  value?: string;
  source?: Exclude<FeishuTokenSource, "env" | "none">;
} {
  const direct = config?.appSecret?.trim();
  if (direct) {
    return { value: direct, source: "config" };
  }
  const fromFile = readFileIfExists(config?.appSecretFile);
  if (fromFile) {
    return { value: fromFile, source: "file" };
  }
  return {};
}

/**
 * Lists all configured Feishu account IDs from configuration and environment.
 * Automatically includes the default account if base configuration or environment
 * variables are present. All account IDs are normalized for consistency.
 * 
 * @param cfg - The complete OpenClaw configuration
 * @returns Array of normalized account IDs that are configured
 */
export function listFeishuAccountIds(cfg: OpenClawConfig): string[] {
  const feishuCfg = cfg.channels?.feishu;
  const accounts = feishuCfg?.accounts;
  const ids = new Set<string>();

  const baseConfigured = Boolean(
    feishuCfg?.appId?.trim() && (feishuCfg?.appSecret?.trim() || Boolean(feishuCfg?.appSecretFile)),
  );
  const envConfigured = Boolean(
    process.env.FEISHU_APP_ID?.trim() && process.env.FEISHU_APP_SECRET?.trim(),
  );
  if (baseConfigured || envConfigured) {
    ids.add(DEFAULT_ACCOUNT_ID);
  }

  if (accounts) {
    for (const id of Object.keys(accounts)) {
      ids.add(normalizeAccountId(id));
    }
  }

  return Array.from(ids);
}

/**
 * Resolves the default Feishu account ID to use when none is specified.
 * Prefers the standard default account ID if available, otherwise returns
 * the first configured account, or falls back to the default ID.
 * 
 * @param cfg - The complete OpenClaw configuration
 * @returns The account ID to use as default
 */
export function resolveDefaultFeishuAccountId(cfg: OpenClawConfig): string {
  const ids = listFeishuAccountIds(cfg);
  if (ids.includes(DEFAULT_ACCOUNT_ID)) {
    return DEFAULT_ACCOUNT_ID;
  }
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

/**
 * Resolves a complete Feishu account configuration with all sources merged.
 * 
 * This function performs comprehensive account resolution by:
 * - Merging base configuration with account-specific overrides
 * - Resolving app secrets from config, files, or environment variables
 * - Determining the token source and account enablement status
 * - Normalizing account IDs and extracting display names
 * 
 * The resolution priority for app secrets is:
 * 1. Account-specific configuration (appSecret field)
 * 2. Account-specific file (appSecretFile field)
 * 3. Environment variables (for default account only)
 * 
 * @param params - Parameters for account resolution
 * @param params.cfg - The complete OpenClaw configuration
 * @param params.accountId - Account ID to resolve (uses default if not specified)
 * @returns Fully resolved account configuration with enablement status
 */
export function resolveFeishuAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ResolvedFeishuAccount {
  const accountId = normalizeAccountId(params.accountId);
  const baseEnabled = params.cfg.channels?.feishu?.enabled !== false;
  const merged = mergeFeishuAccountConfig(params.cfg, accountId);
  const accountEnabled = merged.enabled !== false;
  const enabled = baseEnabled && accountEnabled;

  const allowEnv = accountId === DEFAULT_ACCOUNT_ID;
  const envAppId = allowEnv ? process.env.FEISHU_APP_ID?.trim() : undefined;
  const envAppSecret = allowEnv ? process.env.FEISHU_APP_SECRET?.trim() : undefined;

  const appId = merged.appId?.trim() || envAppId || "";
  const secretResolution = resolveAppSecret(merged);
  const appSecret = secretResolution.value ?? envAppSecret ?? "";

  let tokenSource: FeishuTokenSource = "none";
  if (secretResolution.value) {
    tokenSource = secretResolution.source ?? "config";
  } else if (envAppSecret) {
    tokenSource = "env";
  }
  if (!appId || !appSecret) {
    tokenSource = "none";
  }

  const config: FeishuAccountConfig = {
    ...merged,
    appId,
    appSecret,
  };

  const name = config.name?.trim() || config.botName?.trim() || undefined;

  return {
    accountId,
    config,
    tokenSource,
    name,
    enabled,
  };
}
