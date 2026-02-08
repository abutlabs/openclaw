/**
 * @fileoverview Core type definitions for Feishu (Lark) integration.
 * 
 * This module provides TypeScript type definitions used throughout the Feishu integration,
 * including configuration types and runtime context objects for handling Feishu messages
 * and user interactions.
 */

import type { FeishuAccountConfig, FeishuConfig } from "../config/types.feishu.js";

// Re-export configuration types for convenience
export type { FeishuConfig, FeishuAccountConfig };

/**
 * Runtime context information for Feishu message processing and user interactions.
 * 
 * This context object is created during message handling and contains all relevant
 * identifiers and metadata needed to process and respond to Feishu events.
 * The context helps maintain conversation state and enables proper routing of
 * responses back to the correct users and chat groups.
 */
export type FeishuContext = {
  /** Feishu application ID - identifies which bot app is handling the interaction */
  appId: string;
  
  /** Chat/group identifier where the message originated (for group chats) */
  chatId?: string;
  
  /** OpenID of the user who sent the message (privacy-focused user identifier) */
  openId?: string;
  
  /** User ID of the sender (more permanent user identifier) */
  userId?: string;
  
  /** Unique identifier for the specific message being processed */
  messageId?: string;
  
  /** Type of message (text, image, file, etc.) as defined by Feishu API */
  messageType?: string;
  
  /** Plain text content of the message (for text messages) */
  text?: string;
  
  /** Raw message object from Feishu API for advanced processing */
  raw?: unknown;
};
