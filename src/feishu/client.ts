import * as Lark from "@larksuiteoapi/node-sdk";
import fs from "node:fs";
import { loadConfig } from "../config/config.js";
import { getChildLogger } from "../logging.js";
import { DEFAULT_ACCOUNT_ID } from "../routing/session-key.js";
import { normalizeFeishuDomain } from "./domain.js";

/**
 * @fileoverview Feishu client factory and configuration resolution utilities.
 * 
 * This module provides a factory function for creating authenticated Feishu (Lark) SDK clients
 * with automatic configuration resolution from multiple sources including OpenClaw config,
 * account-specific overrides, environment variables, and external files.
 */

const logger = getChildLogger({ module: "feishu-client" });

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
 * Resolves the Feishu app secret from configuration or external file.
 * Prioritizes direct configuration over file-based secrets.
 * 
 * @param config - Configuration object with app secret settings
 * @returns The resolved app secret string, or undefined if not found
 */
function resolveAppSecret(config?: {
  appSecret?: string;
  appSecretFile?: string;
}): string | undefined {
  const direct = config?.appSecret?.trim();
  if (direct) {
    return direct;
  }
  return readFileIfExists(config?.appSecretFile);
}

/**
 * Creates and configures a Feishu (Lark) SDK client with automatic credential resolution.
 * 
 * This function handles complex credential resolution from multiple sources in priority order:
 * 1. Explicit app secret parameter (highest priority)
 * 2. Account-specific configuration from OpenClaw config
 * 3. Base Feishu configuration (backward compatibility)
 * 4. Environment variables (FEISHU_APP_ID, FEISHU_APP_SECRET)
 * 
 * The function can accept either an account ID or an app ID:
 * - Account ID: Looks up configuration from channels.feishu.accounts[accountId]
 * - App ID (starts with "cli_"): Searches for matching appId across all accounts
 * 
 * Features:
 * - Automatic domain normalization for different Feishu deployment regions
 * - File-based secret loading for secure credential management
 * - Integrated logging with OpenClaw's logging system
 * - Fallback to environment variables for containerized deployments
 * - Multiple account support with per-account overrides
 * 
 * @param accountIdOrAppId - Account identifier or Feishu app ID to use for client creation.
 *                          If starts with "cli_", treated as app ID; otherwise as account ID.
 *                          Defaults to DEFAULT_ACCOUNT_ID if not provided.
 * @param explicitAppSecret - Optional app secret to use directly, bypassing config resolution
 * @returns Configured Lark SDK client ready for API calls
 * @throws {Error} When app ID or app secret cannot be resolved from any source
 * 
 * @example
 * ```typescript
 * // Create client using default account
 * const client = getFeishuClient();
 * 
 * // Create client for specific account
 * const accountClient = getFeishuClient("production");
 * 
 * // Create client using app ID directly
 * const appClient = getFeishuClient("cli_a1b2c3d4e5f6g7h8");
 * 
 * // Create client with explicit secret
 * const secureClient = getFeishuClient("production", "secret_from_vault");
 * ```
 */
export function getFeishuClient(accountIdOrAppId?: string, explicitAppSecret?: string) {
  const cfg = loadConfig();
  const feishuCfg = cfg.channels?.feishu;

  let appId: string | undefined;
  let appSecret: string | undefined = explicitAppSecret?.trim() || undefined;
  let domain: string | undefined;

  // Determine if we received an accountId or an appId
  const isAppId = accountIdOrAppId?.startsWith("cli_");
  const accountId = isAppId ? undefined : accountIdOrAppId || DEFAULT_ACCOUNT_ID;

  if (!appSecret && feishuCfg?.accounts) {
    if (isAppId) {
      // When given an appId, find the account with matching appId
      for (const [, acc] of Object.entries(feishuCfg.accounts)) {
        if (acc.appId === accountIdOrAppId) {
          appId = acc.appId;
          appSecret = resolveAppSecret(acc);
          domain = acc.domain ?? feishuCfg?.domain;
          break;
        }
      }
      // If not found in accounts, use the appId directly (secret from first account as fallback)
      if (!appSecret) {
        appId = accountIdOrAppId;
        const firstKey = Object.keys(feishuCfg.accounts)[0];
        if (firstKey) {
          const acc = feishuCfg.accounts[firstKey];
          appSecret = resolveAppSecret(acc);
          domain = acc.domain ?? feishuCfg?.domain;
        }
      }
    } else if (accountId && feishuCfg.accounts[accountId]) {
      // Try to get from accounts config by accountId
      const acc = feishuCfg.accounts[accountId];
      appId = acc.appId;
      appSecret = resolveAppSecret(acc);
      domain = acc.domain ?? feishuCfg?.domain;
    } else if (!accountId) {
      // Fallback to first account if accountId is not specified
      const firstKey = Object.keys(feishuCfg.accounts)[0];
      if (firstKey) {
        const acc = feishuCfg.accounts[firstKey];
        appId = acc.appId;
        appSecret = resolveAppSecret(acc);
        domain = acc.domain ?? feishuCfg?.domain;
      }
    }
  }

  // Fallback to top-level feishu config (for backward compatibility)
  if (!appId && feishuCfg?.appId) {
    appId = feishuCfg.appId.trim();
  }
  if (!appSecret) {
    appSecret = resolveAppSecret(feishuCfg);
  }
  if (!domain) {
    domain = feishuCfg?.domain;
  }

  // Environment variables fallback
  if (!appId) {
    appId = process.env.FEISHU_APP_ID?.trim();
  }
  if (!appSecret) {
    appSecret = process.env.FEISHU_APP_SECRET?.trim();
  }

  if (!appId || !appSecret) {
    throw new Error(
      "Feishu app ID/secret not configured. Set channels.feishu.accounts.<id>.appId/appSecret (or appSecretFile) or FEISHU_APP_ID/FEISHU_APP_SECRET.",
    );
  }

  const resolvedDomain = normalizeFeishuDomain(domain);

  const client = new Lark.Client({
    appId,
    appSecret,
    ...(resolvedDomain ? { domain: resolvedDomain } : {}),
    logger: {
      debug: (msg) => {
        logger.debug(msg);
      },
      info: (msg) => {
        logger.info(msg);
      },
      warn: (msg) => {
        logger.warn(msg);
      },
      error: (msg) => {
        logger.error(msg);
      },
      trace: (msg) => {
        logger.silly(msg);
      },
    },
  });

  return client;
}
