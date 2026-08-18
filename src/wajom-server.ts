/**
 * Wajom MCP server — read-only analytics over the Wajom SQLite database.
 * 19 tools, all prefixed `wajom_`.
 */

import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import * as q from "./core/queries.ts";
import * as wq from "./core/wajom-queries.ts";
import {
  type ServerConfig,
  createDbLazy,
  json,
  runServer,
} from "./server-factory.ts";

const config: ServerConfig = {
  product: "wajom",
  name: "wajom-mcp",
  defaultPort: 8100,
  dbEnvVar: "WAJOM_DB_PATH",
  defaultDbPath: "devdb.sqlite3",
};

const getDb = createDbLazy(config);
const server = new McpServer({ name: config.name, version: "0.1.0" });

// -- users -------------------------------------------------------------------

server.registerTool(
  "wajom_list_users",
  {
    description:
      "List Wajom users. Search matches name/email/phone. Dates are ISO-8601.",
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
  async (args) => ({
    content: [{ type: "text", text: json(q.listUsers(getDb(), args)) }],
  })
);

server.registerTool(
  "wajom_get_user",
  {
    description:
      "Get a Wajom user's full profile: plan, WhatsApp count, purchase stats, affiliate stats.",
    inputSchema: z.object({
      user_id: z.string().optional().nullable(),
      email: z.string().optional().nullable(),
    }),
  },
  async (args) => {
    const result = q.getUserDetail(getDb(), args.user_id, args.email);
    return {
      content: [{ type: "text", text: json(result ?? { error: "user not found" }) }],
    };
  }
);

// -- orders ------------------------------------------------------------------

server.registerTool(
  "wajom_list_orders",
  {
    description:
      "List Wajom orders (sales). Filter by status, user, affiliate, gateway, coupon, product, date range. Statuses: InitiateCheckout, AddPaymentInfo, Purchase, Complete, Failed. Products: 'Bulanan', 'Wajom Mastery — Kelas Chat AI'.",
    inputSchema: z.object({
      status: z.string().optional().nullable(),
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
  async (args) => ({ content: [{ type: "text", text: json(q.listOrders(getDb(), args)) }] })
);

server.registerTool(
  "wajom_get_order",
  {
    description: "Get a single Wajom order with joined user, plan, and coupon details.",
    inputSchema: z.object({ order_id: z.string() }),
  },
  async (args) => {
    const result = q.getOrder(getDb(), args.order_id);
    return { content: [{ type: "text", text: json(result ?? { error: "order not found" }) }] };
  }
);

server.registerTool(
  "wajom_order_stats",
  {
    description:
      "Aggregate Wajom order statistics. group_by: status|product|gateway|day|month. Returns buckets with count + revenue per group. Revenue is in MYR.",
    inputSchema: z.object({
      group_by: z.string().optional().default("status"),
      date_from: z.string().optional().nullable(),
      date_to: z.string().optional().nullable(),
    }),
  },
  async (args) => ({ content: [{ type: "text", text: json(q.orderStats(getDb(), args)) }] })
);

server.registerTool(
  "wajom_list_abandoned",
  {
    description:
      "List Wajom abandoned checkouts: stuck in InitiateCheckout/AddPaymentInfo for >hours with no Purchase.",
    inputSchema: z.object({
      hours: z.number().optional().default(24),
      limit: z.number().optional().default(50),
      offset: z.number().optional().default(0),
    }),
  },
  async (args) => ({ content: [{ type: "text", text: json(q.listAbandonedCheckouts(getDb(), args)) }] })
);

// -- plans -------------------------------------------------------------------

server.registerTool(
  "wajom_list_plans",
  {
    description: "List Wajom subscription plans with pricing and duration.",
    inputSchema: z.object({ active_only: z.boolean().optional().default(true) }),
  },
  async (args) => ({ content: [{ type: "text", text: json(q.listPlans(getDb(), args.active_only)) }] })
);

server.registerTool(
  "wajom_get_plan",
  {
    description: "Get a Wajom plan with subscriber count and revenue.",
    inputSchema: z.object({ plan_id: z.string() }),
  },
  async (args) => {
    const result = q.getPlan(getDb(), args.plan_id);
    return { content: [{ type: "text", text: json(result ?? { error: "plan not found" }) }] };
  }
);

// -- coupons -----------------------------------------------------------------

server.registerTool(
  "wajom_list_coupons",
  {
    description: "List Wajom coupons. Filter by status (active/inactive) and validity date range.",
    inputSchema: z.object({
      status: z.string().optional().nullable(),
      date_from: z.string().optional().nullable(),
      date_to: z.string().optional().nullable(),
      limit: z.number().optional().default(50),
      offset: z.number().optional().default(0),
    }),
  },
  async (args) => ({ content: [{ type: "text", text: json(q.listCoupons(getDb(), args)) }] })
);

server.registerTool(
  "wajom_get_coupon",
  {
    description: "Get a Wajom coupon by code or ID, with usage stats and recent usage log.",
    inputSchema: z.object({
      code: z.string().optional().nullable(),
      coupon_id: z.string().optional().nullable(),
    }),
  },
  async (args) => {
    const result = q.getCoupon(getDb(), args);
    return { content: [{ type: "text", text: json(result ?? { error: "coupon not found" }) }] };
  }
);

// -- whatsapp ----------------------------------------------------------------

server.registerTool(
  "wajom_list_whatsapps",
  {
    description: "List Wajom WhatsApp devices. Filter by user, connection status, server.",
    inputSchema: z.object({
      user_id: z.string().optional().nullable(),
      status: z.string().optional().nullable(),
      server_id: z.string().optional().nullable(),
      include_deleted: z.boolean().optional().default(false),
      limit: z.number().optional().default(50),
      offset: z.number().optional().default(0),
    }),
  },
  async (args) => ({ content: [{ type: "text", text: json(q.listWhatsapps(getDb(), args)) }] })
);

server.registerTool(
  "wajom_get_whatsapp",
  {
    description:
      "Get a Wajom WhatsApp device with permissions, Google connections, AI integrations.",
    inputSchema: z.object({ whatsapp_id: z.string() }),
  },
  async (args) => {
    const result = q.getWhatsappDetail(getDb(), args.whatsapp_id);
    return { content: [{ type: "text", text: json(result ?? { error: "whatsapp device not found" }) }] };
  }
);

server.registerTool(
  "wajom_whatsapp_health",
  {
    description:
      "Wajom WhatsApp server health: capacity, usage, device status breakdown per server.",
    inputSchema: z.object({}),
  },
  async () => ({ content: [{ type: "text", text: json(q.whatsappHealth(getDb())) }] })
);

// -- affiliate ---------------------------------------------------------------

server.registerTool(
  "wajom_list_affiliates",
  {
    description:
      "List Wajom affiliates (users with affiliate_id) with referral count and commission.",
    inputSchema: z.object({
      limit: z.number().optional().default(50),
      offset: z.number().optional().default(0),
    }),
  },
  async (args) => ({ content: [{ type: "text", text: json(q.listAffiliates(getDb(), args)) }] })
);

server.registerTool(
  "wajom_get_affiliate",
  {
    description: "Get a Wajom affiliate's detail: referral sales, withdrawals.",
    inputSchema: z.object({ affiliate_id: z.string() }),
  },
  async (args) => {
    const result = q.getAffiliateDetail(getDb(), args.affiliate_id);
    return { content: [{ type: "text", text: json(result ?? { error: "affiliate not found" }) }] };
  }
);

// -- feedback + activity -----------------------------------------------------

server.registerTool(
  "wajom_list_feedbacks",
  {
    description: "List Wajom feedback/testimonials. Filter by type and rating range.",
    inputSchema: z.object({
      type: z.string().optional().nullable(),
      min_rating: z.number().optional().nullable(),
      max_rating: z.number().optional().nullable(),
      limit: z.number().optional().default(50),
      offset: z.number().optional().default(0),
    }),
  },
  async (args) => ({ content: [{ type: "text", text: json(q.listFeedbacks(getDb(), args)) }] })
);

server.registerTool(
  "wajom_user_activity",
  {
    description: "Get Wajom user activity: tracking counters and recent events.",
    inputSchema: z.object({ user_id: z.string(), events: z.boolean().optional().default(true) }),
  },
  async (args) => ({ content: [{ type: "text", text: json(q.userActivity(getDb(), args.user_id, args.events)) }] })
);

// -- wajom-only: class participants ------------------------------------------

server.registerTool(
  "wajom_list_class_participants",
  {
    description:
      "List Wajom class participants (Wajom Mastery course enrollees). Filter by payment status (InitiateCheckout/Paid/Failed), affiliate, name/email/phone search, date range. Amount is in MYR.",
    inputSchema: z.object({
      status: z.string().optional().nullable(),
      affiliate_id: z.string().optional().nullable(),
      search: z.string().optional().nullable(),
      date_from: z.string().optional().nullable(),
      date_to: z.string().optional().nullable(),
      limit: z.number().optional().default(50),
      offset: z.number().optional().default(0),
    }),
  },
  async (args) => ({ content: [{ type: "text", text: json(wq.listClassParticipants(getDb(), args)) }] })
);

server.registerTool(
  "wajom_class_stats",
  {
    description:
      "Wajom class participant funnel stats: conversion by status, revenue, top affiliates.",
    inputSchema: z.object({
      date_from: z.string().optional().nullable(),
      date_to: z.string().optional().nullable(),
    }),
  },
  async (args) => ({ content: [{ type: "text", text: json(wq.classParticipantStats(getDb(), args)) }] })
);

// -- entry -------------------------------------------------------------------

runServer(server, config);
