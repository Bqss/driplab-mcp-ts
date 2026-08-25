/**
 * Dripsender MCP server — read-only analytics over the Dripsender SQLite database.
 * 23 tools, all prefixed `dripsender_`.
 */

import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import * as q from "./core/queries.ts";
import * as dq from "./core/dripsender-queries.ts";
import {
  type ServerConfig,
  camelArgs,
  createDbLazy,
  json,
  runServer,
} from "./server-factory.ts";

const config: ServerConfig = {
  product: "dripsender",
  name: "dripsender-mcp",
  defaultPort: 8101,
  dbEnvVar: "DRIPSENDER_DB_PATH",
  defaultDbPath: "devdb copy.sqlite3",
};

const getDb = createDbLazy(config);
const server = new McpServer({ name: config.name, version: "0.1.0" });

// -- users -------------------------------------------------------------------

server.registerTool(
  "dripsender_list_users",
  {
    description: "List Dripsender users. Search matches name/email/phone. Dates are ISO-8601.",
    inputSchema: z.object({
      search: z.string().optional().nullable(),
      paid_only: z.boolean().optional(),
      suspended: z.boolean().optional().nullable(),
      plan_id: z.string().optional().nullable(),
      is_admin: z.boolean().optional().nullable(),
      date_from: z.string().optional().nullable(),
      date_to: z.string().optional().nullable(),
      limit: z.number().optional().default(50),
      offset: z.number().optional().default(0),
    }),
  },
  async (args) => ({ content: [{ type: "text", text: json(q.listUsers(getDb(), camelArgs(args))) }] })
);

server.registerTool(
  "dripsender_get_user",
  {
    description:
      "Get a Dripsender user's full profile: plan, WhatsApp count, purchase stats, affiliate, balance.",
    inputSchema: z.object({
      user_id: z.string().optional().nullable(),
      email: z.string().optional().nullable(),
    }),
  },
  async (args) => {
    const result = q.getUserDetail(getDb(), args.user_id, args.email);
    return { content: [{ type: "text", text: json(result ?? { error: "user not found" }) }] };
  }
);

// -- orders ------------------------------------------------------------------

server.registerTool(
  "dripsender_list_orders",
  {
    description:
      "List Dripsender orders (sales). Filter by status, order_type (plan|token), user, affiliate, gateway, coupon, product, date range. Amounts are in IDR.",
    inputSchema: z.object({
      status: z.string().optional().nullable(),
      order_type: z.string().optional().nullable(),
      user_id: z.string().optional().nullable(),
      affiliate_id: z.string().optional().nullable(),
      payment_gateway: z.string().optional().nullable(),
      coupon_code: z.string().optional().nullable(),
      product: z.string().optional().nullable(),
      date_from: z.string().optional().nullable(),
      date_to: z.string().optional().nullable(),
      limit: z.number().optional().default(50),
      offset: z.number().optional().default(0),
    }),
  },
  async (args) => ({ content: [{ type: "text", text: json(q.listOrders(getDb(), camelArgs(args))) }] })
);

server.registerTool(
  "dripsender_get_order",
  {
    description: "Get a single Dripsender order with joined user, plan, and coupon details.",
    inputSchema: z.object({ order_id: z.string() }),
  },
  async (args) => {
    const result = q.getOrder(getDb(), args.order_id);
    return { content: [{ type: "text", text: json(result ?? { error: "order not found" }) }] };
  }
);

server.registerTool(
  "dripsender_order_stats",
  {
    description:
      "Aggregate Dripsender order statistics. group_by: status|product|gateway|order_type|day|month. Revenue is in IDR.",
    inputSchema: z.object({
      group_by: z.string().optional().default("status"),
      date_from: z.string().optional().nullable(),
      date_to: z.string().optional().nullable(),
    }),
  },
  async (args) => ({ content: [{ type: "text", text: json(q.orderStats(getDb(), camelArgs(args))) }] })
);

server.registerTool(
  "dripsender_list_abandoned",
  {
    description:
      "List Dripsender abandoned checkouts: stuck in InitiateCheckout/AddPaymentInfo for >hours with no Purchase.",
    inputSchema: z.object({
      hours: z.number().optional().default(24),
      limit: z.number().optional().default(50),
      offset: z.number().optional().default(0),
    }),
  },
  async (args) => ({ content: [{ type: "text", text: json(q.listAbandonedCheckouts(getDb(), camelArgs(args))) }] })
);

server.registerTool(
  "dripsender_list_token_purchases",
  {
    description:
      "List Dripsender token purchases (order_type='token'), joined with token package titles. Use this to track ChatGPT/AI token top-ups. Amounts are in IDR.",
    inputSchema: z.object({
      user_id: z.string().optional().nullable(),
      status: z.string().optional().nullable(),
      date_from: z.string().optional().nullable(),
      date_to: z.string().optional().nullable(),
      limit: z.number().optional().default(50),
      offset: z.number().optional().default(0),
    }),
  },
  async (args) => ({ content: [{ type: "text", text: json(dq.listTokenPurchases(getDb(), camelArgs(args))) }] })
);

// -- plans -------------------------------------------------------------------

server.registerTool(
  "dripsender_list_plans",
  {
    description: "List Dripsender subscription plans with pricing, duration, and plan_type.",
    inputSchema: z.object({ active_only: z.boolean().optional().default(true) }),
  },
  async (args) => ({ content: [{ type: "text", text: json(q.listPlans(getDb(), args.active_only)) }] })
);

server.registerTool(
  "dripsender_get_plan",
  {
    description: "Get a Dripsender plan with subscriber count and revenue.",
    inputSchema: z.object({ plan_id: z.string() }),
  },
  async (args) => {
    const result = q.getPlan(getDb(), args.plan_id);
    return { content: [{ type: "text", text: json(result ?? { error: "plan not found" }) }] };
  }
);

// -- coupons -----------------------------------------------------------------

server.registerTool(
  "dripsender_list_coupons",
  {
    description: "List Dripsender coupons. Filter by status (active/inactive) and validity date range.",
    inputSchema: z.object({
      status: z.string().optional().nullable(),
      date_from: z.string().optional().nullable(),
      date_to: z.string().optional().nullable(),
      limit: z.number().optional().default(50),
      offset: z.number().optional().default(0),
    }),
  },
  async (args) => ({ content: [{ type: "text", text: json(q.listCoupons(getDb(), camelArgs(args))) }] })
);

server.registerTool(
  "dripsender_get_coupon",
  {
    description: "Get a Dripsender coupon by code or ID, with usage stats and recent usage log.",
    inputSchema: z.object({
      code: z.string().optional().nullable(),
      coupon_id: z.string().optional().nullable(),
    }),
  },
  async (args) => {
    const result = q.getCoupon(getDb(), camelArgs(args));
    return { content: [{ type: "text", text: json(result ?? { error: "coupon not found" }) }] };
  }
);

// -- whatsapp ----------------------------------------------------------------

server.registerTool(
  "dripsender_list_whatsapps",
  {
    description: "List Dripsender WhatsApp devices. Filter by user, connection status, server.",
    inputSchema: z.object({
      user_id: z.string().optional().nullable(),
      status: z.string().optional().nullable(),
      server_id: z.string().optional().nullable(),
      include_deleted: z.boolean().optional().default(false),
      limit: z.number().optional().default(50),
      offset: z.number().optional().default(0),
    }),
  },
  async (args) => ({ content: [{ type: "text", text: json(q.listWhatsapps(getDb(), camelArgs(args))) }] })
);

server.registerTool(
  "dripsender_get_whatsapp",
  {
    description:
      "Get a Dripsender WhatsApp device with permissions, Google connections, AI integrations.",
    inputSchema: z.object({ whatsapp_id: z.string() }),
  },
  async (args) => {
    const result = q.getWhatsappDetail(getDb(), args.whatsapp_id);
    return { content: [{ type: "text", text: json(result ?? { error: "whatsapp device not found" }) }] };
  }
);

server.registerTool(
  "dripsender_whatsapp_health",
  {
    description:
      "Dripsender WhatsApp server health: capacity, usage, device status breakdown per server.",
    inputSchema: z.object({}),
  },
  async () => ({ content: [{ type: "text", text: json(q.whatsappHealth(getDb())) }] })
);

// -- affiliate ---------------------------------------------------------------

server.registerTool(
  "dripsender_list_affiliates",
  {
    description:
      "List Dripsender affiliates (users with affiliate_id) with referral count and commission.",
    inputSchema: z.object({
      limit: z.number().optional().default(50),
      offset: z.number().optional().default(0),
    }),
  },
  async (args) => ({ content: [{ type: "text", text: json(q.listAffiliates(getDb(), camelArgs(args))) }] })
);

server.registerTool(
  "dripsender_get_affiliate",
  {
    description:
      "Get a Dripsender affiliate's detail: referral sales, withdrawals, merchant payouts.",
    inputSchema: z.object({ affiliate_id: z.string() }),
  },
  async (args) => {
    const result = q.getAffiliateDetail(getDb(), args.affiliate_id);
    return { content: [{ type: "text", text: json(result ?? { error: "affiliate not found" }) }] };
  }
);

// -- feedback + activity -----------------------------------------------------

server.registerTool(
  "dripsender_list_feedbacks",
  {
    description: "List Dripsender feedback/testimonials. Filter by type and rating range.",
    inputSchema: z.object({
      type: z.string().optional().nullable(),
      min_rating: z.number().optional().nullable(),
      max_rating: z.number().optional().nullable(),
      limit: z.number().optional().default(50),
      offset: z.number().optional().default(0),
    }),
  },
  async (args) => ({ content: [{ type: "text", text: json(q.listFeedbacks(getDb(), camelArgs(args))) }] })
);

server.registerTool(
  "dripsender_user_activity",
  {
    description: "Get Dripsender user activity: tracking counters and recent events.",
    inputSchema: z.object({ user_id: z.string(), events: z.boolean().optional().default(true) }),
  },
  async (args) => ({ content: [{ type: "text", text: json(q.userActivity(getDb(), args.user_id, args.events)) }] })
);

// -- dripsender-only: payouts ------------------------------------------------

server.registerTool(
  "dripsender_list_payouts",
  {
    description:
      "List Dripsender merchant payouts (affiliate commission withdrawals via Xendit). Filter by status (pending/complete/failed), user, date range. Amounts in IDR.",
    inputSchema: z.object({
      status: z.string().optional().nullable(),
      user_id: z.string().optional().nullable(),
      date_from: z.string().optional().nullable(),
      date_to: z.string().optional().nullable(),
      limit: z.number().optional().default(50),
      offset: z.number().optional().default(0),
    }),
  },
  async (args) => ({ content: [{ type: "text", text: json(dq.listPayouts(getDb(), camelArgs(args))) }] })
);

// -- dripsender-only: premium plugins ----------------------------------------

server.registerTool(
  "dripsender_list_premium_plugins",
  {
    description:
      "List Dripsender premium plugins available for activation (e.g. Berdu.id, Custom Actions).",
    inputSchema: z.object({ active_only: z.boolean().optional().default(true) }),
  },
  async (args) => ({ content: [{ type: "text", text: json(dq.listPremiumPlugins(getDb(), args.active_only)) }] })
);

server.registerTool(
  "dripsender_list_user_plugins",
  {
    description:
      "List Dripsender user-plugin activations. See which users activated which premium plugins.",
    inputSchema: z.object({
      user_id: z.string().optional().nullable(),
      plugin_id: z.string().optional().nullable(),
      active_only: z.boolean().optional().default(true),
      limit: z.number().optional().default(50),
      offset: z.number().optional().default(0),
    }),
  },
  async (args) => ({ content: [{ type: "text", text: json(dq.listUserPlugins(getDb(), camelArgs(args))) }] })
);

// -- dripsender-only: website syncs ------------------------------------------

server.registerTool(
  "dripsender_list_website_syncs",
  {
    description:
      "List Dripsender website sync jobs (Firecrawl-based). Use include_pages=true to get synced pages. Useful for troubleshooting RAG/knowledge base sync status.",
    inputSchema: z.object({
      wa_id: z.string().optional().nullable(),
      status: z.string().optional().nullable(),
      include_pages: z.boolean().optional().default(false),
      limit: z.number().optional().default(50),
      offset: z.number().optional().default(0),
    }),
  },
  async (args) => ({ content: [{ type: "text", text: json(dq.listWebsiteSyncs(getDb(), camelArgs(args))) }] })
);

// -- dripsender-only: training data ------------------------------------------

server.registerTool(
  "dripsender_list_training_data",
  {
    description:
      "List Dripsender Chat AI training data files per WhatsApp device. Track file processing status (pending/completed/failed) for knowledge base uploads.",
    inputSchema: z.object({
      wa_id: z.string().optional().nullable(),
      status: z.string().optional().nullable(),
      limit: z.number().optional().default(50),
      offset: z.number().optional().default(0),
    }),
  },
  async (args) => ({ content: [{ type: "text", text: json(dq.listTrainingDataFiles(getDb(), camelArgs(args))) }] })
);

// -- entry -------------------------------------------------------------------

runServer(server, config);
