/**
 * @fileoverview Feishu (Lark) connectivity testing and bot information retrieval.
 * 
 * This module provides functionality to probe Feishu API endpoints to validate
 * authentication credentials, test connectivity, and retrieve bot information.
 * The probe function performs a two-step process: first obtaining an access token,
 * then using that token to fetch bot details. This is useful for configuration
 * validation and health checks.
 */

import { formatErrorMessage } from "../infra/errors.js";
import { getChildLogger } from "../logging.js";
import { resolveFeishuApiBase } from "./domain.js";

const logger = getChildLogger({ module: "feishu-probe" });

/**
 * Result object from a Feishu connectivity probe operation.
 * 
 * Contains the outcome of testing Feishu API connectivity including
 * success status, any errors encountered, timing information, and
 * retrieved bot details when the probe succeeds.
 */
export type FeishuProbe = {
  /** Whether the probe operation completed successfully */
  ok: boolean;
  
  /** Error message if the probe failed, null if successful */
  error?: string | null;
  
  /** Total elapsed time for the probe operation in milliseconds */
  elapsedMs: number;
  
  /** Bot information retrieved during successful probe */
  bot?: {
    /** Feishu application ID used for the probe */
    appId?: string | null;
    
    /** Human-readable name of the bot application */
    appName?: string | null;
    
    /** URL to the bot's avatar image */
    avatarUrl?: string | null;
  };
};

/** Response structure from Feishu tenant access token API endpoint */
type TokenResponse = {
  /** Response code (0 indicates success) */
  code: number;
  
  /** Human-readable response message */
  msg: string;
  
  /** Tenant access token for subsequent API calls */
  tenant_access_token?: string;
  
  /** Token expiration time in seconds */
  expire?: number;
};

/** Response structure from Feishu bot info API endpoint */
type BotInfoResponse = {
  /** Response code (0 indicates success) */
  code: number;
  
  /** Human-readable response message */
  msg: string;
  
  /** Bot information object */
  bot?: {
    /** Display name of the bot application */
    app_name?: string;
    
    /** URL to the bot's avatar image */
    avatar_url?: string;
    
    /** Open ID of the bot */
    open_id?: string;
  };
};

/**
 * Performs a fetch request with a timeout mechanism.
 * 
 * This utility function wraps the standard fetch API to add timeout support
 * using AbortController. The request will be automatically cancelled if it
 * exceeds the specified timeout duration.
 * 
 * @param url - URL to fetch
 * @param options - Fetch options (headers, method, body, etc.)
 * @param timeoutMs - Maximum time to wait for response in milliseconds
 * @returns Promise resolving to the Response object
 * @throws {Error} When the request times out or encounters network errors
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probes Feishu (Lark) API connectivity and retrieves bot information.
 * 
 * This function performs a comprehensive connectivity test by executing a two-step
 * authentication and information retrieval process:
 * 
 * **Step 1: Authentication**
 * - Requests a tenant access token using the provided app ID and secret
 * - Validates the response and extracts the access token
 * - Handles authentication failures and credential issues
 * 
 * **Step 2: Bot Information Retrieval**
 * - Uses the access token to fetch bot details from the Feishu API
 * - Retrieves bot name, avatar URL, and other metadata
 * - Validates the bot info response structure
 * 
 * **Features:**
 * - Configurable timeout for network operations
 * - Support for different Feishu deployment domains (global, China, etc.)
 * - Detailed error reporting with specific failure reasons
 * - Performance timing measurement for diagnostics
 * - Graceful handling of network errors and API failures
 * 
 * **Use Cases:**
 * - Configuration validation during setup
 * - Health checks for monitoring systems
 * - Credential verification before starting services
 * - Debugging connectivity issues
 * 
 * @param appId - Feishu application ID for authentication
 * @param appSecret - Application secret for authentication
 * @param timeoutMs - Maximum time to wait for each API call in milliseconds (default: 5000)
 * @param domain - Optional domain override for different Feishu deployments
 * @returns Promise resolving to probe result with success status and bot information
 * 
 * @example
 * ```typescript
 * // Basic connectivity test
 * const result = await probeFeishu("cli_a1b2c3d4e5f6g7h8", "secret123");
 * if (result.ok) {
 *   console.log(`Bot: ${result.bot?.appName} (${result.elapsedMs}ms)`);
 * } else {
 *   console.error(`Probe failed: ${result.error}`);
 * }
 * 
 * // Custom timeout and domain
 * const result = await probeFeishu(
 *   appId, 
 *   appSecret, 
 *   10000, 
 *   "feishu.cn"
 * );
 * 
 * // Health check usage
 * const isHealthy = (await probeFeishu(appId, appSecret, 3000)).ok;
 * ```
 */
export async function probeFeishu(
  appId: string,
  appSecret: string,
  timeoutMs: number = 5000,
  domain?: string,
): Promise<FeishuProbe> {
  const started = Date.now();

  const result: FeishuProbe = {
    ok: false,
    error: null,
    elapsedMs: 0,
  };

  const apiBase = resolveFeishuApiBase(domain);

  try {
    // Step 1: Get tenant_access_token
    const tokenRes = await fetchWithTimeout(
      `${apiBase}/auth/v3/tenant_access_token/internal`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      },
      timeoutMs,
    );

    const tokenJson = (await tokenRes.json()) as TokenResponse;
    if (tokenJson.code !== 0 || !tokenJson.tenant_access_token) {
      result.error = tokenJson.msg || `Failed to get access token: code ${tokenJson.code}`;
      result.elapsedMs = Date.now() - started;
      return result;
    }

    const accessToken = tokenJson.tenant_access_token;

    // Step 2: Get bot info
    const botRes = await fetchWithTimeout(
      `${apiBase}/bot/v3/info`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      timeoutMs,
    );

    const botJson = (await botRes.json()) as BotInfoResponse;
    if (botJson.code !== 0) {
      result.error = botJson.msg || `Failed to get bot info: code ${botJson.code}`;
      result.elapsedMs = Date.now() - started;
      return result;
    }

    result.ok = true;
    result.bot = {
      appId: appId,
      appName: botJson.bot?.app_name ?? null,
      avatarUrl: botJson.bot?.avatar_url ?? null,
    };
    result.elapsedMs = Date.now() - started;
    return result;
  } catch (err) {
    const errMsg = formatErrorMessage(err);
    logger.debug?.(`Feishu probe failed: ${errMsg}`);
    return {
      ...result,
      error: errMsg,
      elapsedMs: Date.now() - started,
    };
  }
}
