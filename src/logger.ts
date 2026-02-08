import { danger, info, logVerboseConsole, success, warn } from "./globals.js";
import { getLogger } from "./logging/logger.js";
import { createSubsystemLogger } from "./logging/subsystem.js";
import { defaultRuntime, type RuntimeEnv } from "./runtime.js";

const subsystemPrefixRe = /^([a-z][a-z0-9-]{1,20}):\s+(.*)$/i;

/**
 * Splits a log message into subsystem prefix and content if it matches the subsystem format.
 * Format: "subsystem: message" where subsystem is 2-21 chars, alphanumeric with hyphens.
 * 
 * @param message - The log message to parse
 * @returns Object with subsystem and rest properties, or null if no match
 */
function splitSubsystem(message: string) {
  const match = message.match(subsystemPrefixRe);
  if (!match) {
    return null;
  }
  const [, subsystem, rest] = match;
  return { subsystem, rest };
}

/**
 * Logs an informational message to both console and file logger.
 * Automatically routes to subsystem logger if message has subsystem prefix format.
 * 
 * @param message - The message to log
 * @param runtime - Runtime environment for console output (defaults to defaultRuntime)
 */
export function logInfo(message: string, runtime: RuntimeEnv = defaultRuntime) {
  const parsed = runtime === defaultRuntime ? splitSubsystem(message) : null;
  if (parsed) {
    createSubsystemLogger(parsed.subsystem).info(parsed.rest);
    return;
  }
  runtime.log(info(message));
  getLogger().info(message);
}

/**
 * Logs a warning message to both console and file logger.
 * Automatically routes to subsystem logger if message has subsystem prefix format.
 * 
 * @param message - The warning message to log
 * @param runtime - Runtime environment for console output (defaults to defaultRuntime)
 */
export function logWarn(message: string, runtime: RuntimeEnv = defaultRuntime) {
  const parsed = runtime === defaultRuntime ? splitSubsystem(message) : null;
  if (parsed) {
    createSubsystemLogger(parsed.subsystem).warn(parsed.rest);
    return;
  }
  runtime.log(warn(message));
  getLogger().warn(message);
}

/**
 * Logs a success message to both console and file logger.
 * Automatically routes to subsystem logger if message has subsystem prefix format.
 * Success messages are treated as info level in file logs.
 * 
 * @param message - The success message to log
 * @param runtime - Runtime environment for console output (defaults to defaultRuntime)
 */
export function logSuccess(message: string, runtime: RuntimeEnv = defaultRuntime) {
  const parsed = runtime === defaultRuntime ? splitSubsystem(message) : null;
  if (parsed) {
    createSubsystemLogger(parsed.subsystem).info(parsed.rest);
    return;
  }
  runtime.log(success(message));
  getLogger().info(message);
}

/**
 * Logs an error message to both console and file logger.
 * Automatically routes to subsystem logger if message has subsystem prefix format.
 * 
 * @param message - The error message to log
 * @param runtime - Runtime environment for console output (defaults to defaultRuntime)
 */
export function logError(message: string, runtime: RuntimeEnv = defaultRuntime) {
  const parsed = runtime === defaultRuntime ? splitSubsystem(message) : null;
  if (parsed) {
    createSubsystemLogger(parsed.subsystem).error(parsed.rest);
    return;
  }
  runtime.error(danger(message));
  getLogger().error(message);
}

/**
 * Logs a debug message to file logger and console (if verbose mode enabled).
 * Debug messages always go to file logger (subject to level filtering) but only 
 * appear on console when verbose logging is active.
 * 
 * @param message - The debug message to log
 */
export function logDebug(message: string) {
  // Always emit to file logger (level-filtered); console only when verbose.
  getLogger().debug(message);
  logVerboseConsole(message);
}
