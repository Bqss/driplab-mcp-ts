/**
 * PII / secret stripping and row helpers.
 *
 * Every tool output passes through `stripPii` so sensitive columns
 * (passwords, api keys, tokens) never leak to the LLM.
 */

type Row = Record<string, unknown>;

const DENY_COLUMNS: ReadonlySet<string> = new Set([
  "password",
  "remember_me_token",
  "api_key",
  "access_token",
  "access_token_enc",
  "refresh_token",
  "refresh_token_enc",
  "token",
  "secret",
]);

const ALLOWED_COLUMNS: Record<string, string[]> = {
  users: [
    "id", "name", "phone", "email", "is_verified", "plan_id", "membership_date",
    "paid_user", "is_admin", "created_at", "updated_at", "server_id",
    "last_purchase", "last_purchase_amount", "purchase_number", "purchase_amount",
    "last_membership_date", "notes", "last_called", "chat_gpt_token",
    "affiliate_id", "affiliate_rekening", "affiliate_bank", "is_suspended",
    "suspend_reason", "suspended_at",
    "custom_affiliate_slug", "account_name", // wajom
    "custom_affiliate_id", "pending_balance", "available_balance", // dripsender
  ],
  sales: [
    "id", "product", "plan_id", "user_id", "user_name", "user_phone", "user_email",
    "country", "city", "affiliate_id", "affiliate_name", "status", "affiliate_fee",
    "payment_reference", "payment_method", "payment_gateway",
    "affiliate_payment_status", "total", "unique_price", "created_at",
    "updated_at", "expired_time", "followup", "isNew", "coupon_code", "coupon_id",
    "discount_amount", "original_total", "order_type", "token_package_id",
    "token_amount", "token_credited", "invoice_pdf_url",
    "custom_checkout_id", // dripsender
    "package_title", "package_token_amount", // joined from token_packages
  ],
  plans: [
    "id", "title", "description", "call_to_action_text", "point_includes",
    "available_in_checkout", "is_renewable", "active_plan", "time", "time_unit",
    "time_in_day", "time_in_month", "device_number", "price", "fake_price",
    "daily_price", "monthly_price", "default_plan", "created_at", "updated_at",
    "is_annual", "plan_type", "link_url", "link_button_text", // dripsender
  ],
  whatsapps: [
    "id", "name", "phone", "status", "user_id", "server_id", "version", "client",
    "server_name", "port", "tags", "delete_time", "last_name", "last_phone",
    "notif_phone", "notif_phone_active", "enable_wtc", "wtc_number", "wtc_interval",
    "created_at", "updated_at", "timezone_offset", "working_hours", "open_hour",
    "open_minute", "close_hour", "close_minute", "working_days",
    "trial_sent_count",
    "total_sent_count",
    "chat_ai_sent_count",
    "cap_reached_at",
  ],
  servers: [
    "id", "name", "server_url", "connect_url", "capasity", "usage", "available",
    "last_port", "exclusive",
  ],
  coupons: [
    "id", "code", "type", "value", "description", "status", "usage_limit",
    "used_count", "valid_from", "valid_until", "created_at", "updated_at",
    "affiliate_fee_percentage", "restricted_plan_ids",
  ],
  coupon_usage: [
    "id", "coupon_id", "order_id", "user_id", "discount_amount", "used_at",
  ],
  token_packages: [
    "id", "title", "description", "token_amount", "price", "active", "is_custom",
    "sort_order", "created_at", "updated_at", "thumbnail", "fake_price",
  ],
  withdraw: [
    "id", "name", "phone", "user_id", "bank", "no_rekening", "amount",
    "created_at", "bukti_transfer",
  ],
  merchant_payouts: [
    "id", "user_id", "amount", "bank_code", "account_number",
    "account_holder_name", "status", "failure_reason", "admin_notes",
    "processed_at", "created_at", "updated_at",
  ],
  feedbacks: [
    "id", "user_id", "content", "rating", "is_tokenized", "created_at",
    "updated_at", "type",
  ],
  activity_tracking: [
    "id", "user_id", "activity_type", "counter", "created_at", "updated_at",
  ],
  activity_tracking_events: ["id", "user_id", "activity_type", "created_at"],
  class_participants: [
    "id", "full_name", "phone", "email", "business_name", "package_name",
    "amount", "status", "payment_gateway", "payment_reference", "affiliate_id",
    "coupon_code", "discount_amount", "token_credited", "invoice_pdf_url",
    "created_at", "updated_at",
  ],
  webinar_registrants: [
    "id", "name", "email", "phone", "affiliate_id", "created_at", "updated_at",
  ],
  premium_plugins: [
    "id", "name", "slug", "description", "is_active", "created_at", "updated_at",
  ],
  user_premium_plugins: [
    "id", "user_id", "plugin_id", "is_active", "created_at", "updated_at",
    "plugin_name", "plugin_slug", // joined
  ],
  website_syncs: [
    "id", "wa_id", "url", "status", "total_pages", "completed_pages",
    "firecrawl_job_id", "error_message", "created_at", "updated_at",
  ],
  website_sync_pages: [
    "id", "website_sync_id", "url", "title", "status", "is_selected",
    "is_custom", "error_message", "scraped_at", "created_at", "updated_at",
  ],
  training_data_files: [
    "id", "wa_id", "filename", "original_name", "mime_type", "size",
    "file_path", "chunks_count", "status", "error_message", "created_at",
    "updated_at",
  ],
  logout_reports: ["id", "user_id", "whatsapp_id", "server_id", "created_at"],
  connection_logs: ["id", "status", "server_id", "wa_id", "created_at"],
  whatsapp_users: ["whatsapp_id", "user_id", "user_name", "user_email"],
  whatsapp_user_permissions: [
    "id", "whatsapp_id", "user_id", "feature_id", "granted", "created_at",
    "updated_at",
  ],
  open_ai_keys: ["id", "name", "token_left", "created_at"],
  notifiers: [
    "id", "name", "type", "description", "is_active", "created_at",
    "updated_at", "message_template",
  ],
  banner: ["id", "name", "img", "link", "order", "is_active"],
  custom_checkouts: [
    "id", "slug", "title", "description", "plan_ids", "active", "created_at",
    "updated_at", "default_tab",
  ],
  pages: [
    "id", "slug", "title", "content", "is_active", "created_at", "updated_at",
    "type",
  ],
  plan_list_webhooks: [
    "id", "plan_id", "whatsapp_id", "list_id", "list_name", "is_active",
    "created_at", "updated_at",
  ],
};

export function stripPii(rows: Row[], table: string): Row[] {
  const allowed = ALLOWED_COLUMNS[table];
  if (allowed) {
    const set = new Set(allowed);
    return rows.map((r) => {
      const out: Row = {};
      for (const [k, v] of Object.entries(r)) {
        if (set.has(k)) out[k] = v;
      }
      return out;
    });
  }
  // No allowlist: drop denylisted columns only.
  return rows.map((r) => {
    const out: Row = {};
    for (const [k, v] of Object.entries(r)) {
      if (!DENY_COLUMNS.has(k)) out[k] = v;
    }
    return out;
  });
}
