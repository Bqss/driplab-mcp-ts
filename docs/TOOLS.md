# Tools Reference — driplab-mcp

Daftar lengkap semua tool yang tersedia di kedua MCP server. Total **42 tools** (19 Wajom + 23 Dripsender).

Semua tool read-only. Timestamps di-convert dari epoch-ms ke ISO-8601 UTC. Kolom sensitif (password, api_key, token) di-strip sebelum output.

## Wajom MCP Server (19 tools)

Currency: **MYR** (Malaysian Ringgit).

### Users

#### `wajom_list_users`
List Wajom users. Search matches name/email/phone.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `search` | string | optional | — |
| `paid_only` | boolean | optional | false |
| `suspended` | boolean | optional | — |
| `plan_id` | string | optional | — |
| `is_admin` | boolean | optional | — |
| `date_from` | string | optional | — |
| `date_to` | string | optional | — |
| `limit` | number | optional | 50 |
| `offset` | number | optional | 0 |

#### `wajom_get_user`
Get full profile: plan, WhatsApp count, purchase stats, affiliate stats.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `user_id` | string | optional | — |
| `email` | string | optional | — |

### Orders

#### `wajom_list_orders`
List orders (sales). Filter by status, user, affiliate, gateway, coupon, product, date range.

Statuses: `InitiateCheckout`, `AddPaymentInfo`, `Purchase`, `Complete`, `Failed`.
Products: `Bulanan`, `Wajom Mastery — Kelas Chat AI`.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `status` | string | optional | — |
| `user_id` | string | optional | — |
| `affiliate_id` | string | optional | — |
| `payment_gateway` | string | optional | — |
| `coupon_code` | string | optional | — |
| `product` | string | optional | — |
| `date_from` | string | optional | — |
| `date_to` | string | optional | — |
| `limit` | number | optional | 50 |
| `offset` | number | optional | 0 |

#### `wajom_get_order`
Get single order with joined user, plan, coupon details.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `order_id` | string | **required** | — |

#### `wajom_order_stats`
Aggregate order statistics. `group_by`: `status` | `product` | `gateway` | `day` | `month`.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `group_by` | string | optional | `"status"` |
| `date_from` | string | optional | — |
| `date_to` | string | optional | — |

#### `wajom_list_abandoned`
Abandoned checkouts: stuck in InitiateCheckout/AddPaymentInfo for >hours with no Purchase.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `hours` | number | optional | 24 |
| `limit` | number | optional | 50 |
| `offset` | number | optional | 0 |

### Plans

#### `wajom_list_plans`
List subscription plans with pricing and duration.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `active_only` | boolean | optional | true |

#### `wajom_get_plan`
Get plan with subscriber count and revenue.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `plan_id` | string | **required** | — |

### Coupons

#### `wajom_list_coupons`
List coupons. Filter by status (active/inactive) and validity date range.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `status` | string | optional | — |
| `date_from` | string | optional | — |
| `date_to` | string | optional | — |
| `limit` | number | optional | 50 |
| `offset` | number | optional | 0 |

#### `wajom_get_coupon`
Get coupon by code or ID, with usage stats and recent usage log.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `code` | string | optional | — |
| `coupon_id` | string | optional | — |

### WhatsApp

#### `wajom_list_whatsapps`
List WhatsApp devices. Filter by user, status, server.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `user_id` | string | optional | — |
| `status` | string | optional | — |
| `server_id` | string | optional | — |
| `include_deleted` | boolean | optional | false |
| `limit` | number | optional | 50 |
| `offset` | number | optional | 0 |

#### `wajom_get_whatsapp`
Get WhatsApp device with permissions, Google connections, AI integrations.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `whatsapp_id` | string | **required** | — |

#### `wajom_whatsapp_health`
Server health: capacity, usage, device status breakdown per server.

No parameters.

### Affiliate

#### `wajom_list_affiliates`
List affiliates (users with affiliate_id) with referral count and commission.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `limit` | number | optional | 50 |
| `offset` | number | optional | 0 |

#### `wajom_get_affiliate`
Get affiliate detail: referral sales, withdrawals.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `affiliate_id` | string | **required** | — |

### Feedback & Activity

#### `wajom_list_feedbacks`
List feedback/testimonials. Filter by type and rating range.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `type` | string | optional | — |
| `min_rating` | number | optional | — |
| `max_rating` | number | optional | — |
| `limit` | number | optional | 50 |
| `offset` | number | optional | 0 |

#### `wajom_user_activity`
Get user activity: tracking counters and recent events.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `user_id` | string | **required** | — |
| `events` | boolean | optional | true |

### Wajom-only: Class Participants

#### `wajom_list_class_participants`
List class participants (Wajom Mastery course enrollees). Amount in MYR.

Statuses: `InitiateCheckout`, `Paid`, `Failed`.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `status` | string | optional | — |
| `affiliate_id` | string | optional | — |
| `search` | string | optional | — |
| `date_from` | string | optional | — |
| `date_to` | string | optional | — |
| `limit` | number | optional | 50 |
| `offset` | number | optional | 0 |

#### `wajom_class_stats`
Class participant funnel stats: conversion by status, revenue, top affiliates.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `date_from` | string | optional | — |
| `date_to` | string | optional | — |

---

## Dripsender MCP Server (23 tools)

Currency: **IDR** (Indonesian Rupiah).

### Users

#### `dripsender_list_users`
List Dripsender users. Search matches name/email/phone.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `search` | string | optional | — |
| `paid_only` | boolean | optional | false |
| `suspended` | boolean | optional | — |
| `plan_id` | string | optional | — |
| `is_admin` | boolean | optional | — |
| `date_from` | string | optional | — |
| `date_to` | string | optional | — |
| `limit` | number | optional | 50 |
| `offset` | number | optional | 0 |

#### `dripsender_get_user`
Get full profile: plan, WhatsApp count, purchase stats, affiliate, balance.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `user_id` | string | optional | — |
| `email` | string | optional | — |

### Orders

#### `dripsender_list_orders`
List orders (sales). Filter by status, order_type, user, affiliate, gateway, coupon, product, date range.

`order_type`: `plan` | `token`.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `status` | string | optional | — |
| `order_type` | string | optional | — |
| `user_id` | string | optional | — |
| `affiliate_id` | string | optional | — |
| `payment_gateway` | string | optional | — |
| `coupon_code` | string | optional | — |
| `product` | string | optional | — |
| `date_from` | string | optional | — |
| `date_to` | string | optional | — |
| `limit` | number | optional | 50 |
| `offset` | number | optional | 0 |

#### `dripsender_get_order`
Get single order with joined user, plan, coupon details.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `order_id` | string | **required** | — |

#### `dripsender_order_stats`
Aggregate order statistics. `group_by`: `status` | `product` | `gateway` | `order_type` | `day` | `month`.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `group_by` | string | optional | `"status"` |
| `date_from` | string | optional | — |
| `date_to` | string | optional | — |

#### `dripsender_list_abandoned`
Abandoned checkouts: stuck in InitiateCheckout/AddPaymentInfo for >hours with no Purchase.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `hours` | number | optional | 24 |
| `limit` | number | optional | 50 |
| `offset` | number | optional | 0 |

#### `dripsender_list_token_purchases`
List token purchases (order_type='token'), joined with token package titles. Track ChatGPT/AI token top-ups.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `user_id` | string | optional | — |
| `status` | string | optional | — |
| `date_from` | string | optional | — |
| `date_to` | string | optional | — |
| `limit` | number | optional | 50 |
| `offset` | number | optional | 0 |

### Plans

#### `dripsender_list_plans`
List subscription plans with pricing, duration, and plan_type.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `active_only` | boolean | optional | true |

#### `dripsender_get_plan`
Get plan with subscriber count and revenue.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `plan_id` | string | **required** | — |

### Coupons

#### `dripsender_list_coupons`
List coupons. Filter by status (active/inactive) and validity date range.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `status` | string | optional | — |
| `date_from` | string | optional | — |
| `date_to` | string | optional | — |
| `limit` | number | optional | 50 |
| `offset` | number | optional | 0 |

#### `dripsender_get_coupon`
Get coupon by code or ID, with usage stats and recent usage log.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `code` | string | optional | — |
| `coupon_id` | string | optional | — |

### WhatsApp

#### `dripsender_list_whatsapps`
List WhatsApp devices. Filter by user, status, server.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `user_id` | string | optional | — |
| `status` | string | optional | — |
| `server_id` | string | optional | — |
| `include_deleted` | boolean | optional | false |
| `limit` | number | optional | 50 |
| `offset` | number | optional | 0 |

#### `dripsender_get_whatsapp`
Get WhatsApp device with permissions, Google connections, AI integrations.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `whatsapp_id` | string | **required** | — |

#### `dripsender_whatsapp_health`
Server health: capacity, usage, device status breakdown per server.

No parameters.

### Affiliate

#### `dripsender_list_affiliates`
List affiliates with referral count and commission.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `limit` | number | optional | 50 |
| `offset` | number | optional | 0 |

#### `dripsender_get_affiliate`
Get affiliate detail: referral sales, withdrawals, merchant payouts.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `affiliate_id` | string | **required** | — |

### Feedback & Activity

#### `dripsender_list_feedbacks`
List feedback/testimonials. Filter by type and rating range.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `type` | string | optional | — |
| `min_rating` | number | optional | — |
| `max_rating` | number | optional | — |
| `limit` | number | optional | 50 |
| `offset` | number | optional | 0 |

#### `dripsender_user_activity`
Get user activity: tracking counters and recent events.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `user_id` | string | **required** | — |
| `events` | boolean | optional | true |

### Dripsender-only: Payouts

#### `dripsender_list_payouts`
List merchant payouts (affiliate commission withdrawals via Xendit). Amounts in IDR.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `status` | string | optional | — |
| `user_id` | string | optional | — |
| `date_from` | string | optional | — |
| `date_to` | string | optional | — |
| `limit` | number | optional | 50 |
| `offset` | number | optional | 0 |

### Dripsender-only: Premium Plugins

#### `dripsender_list_premium_plugins`
List premium plugins available for activation (e.g. Berdu.id, Custom Actions).

| Parameter | Type | Required | Default |
|---|---|---|---|
| `active_only` | boolean | optional | true |

#### `dripsender_list_user_plugins`
List user-plugin activations. See which users activated which premium plugins.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `user_id` | string | optional | — |
| `plugin_id` | string | optional | — |
| `active_only` | boolean | optional | true |
| `limit` | number | optional | 50 |
| `offset` | number | optional | 0 |

### Dripsender-only: Website Syncs

#### `dripsender_list_website_syncs`
List website sync jobs (Firecrawl-based). Use `include_pages=true` to get synced pages.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `wa_id` | string | optional | — |
| `status` | string | optional | — |
| `include_pages` | boolean | optional | false |
| `limit` | number | optional | 50 |
| `offset` | number | optional | 0 |

### Dripsender-only: Training Data

#### `dripsender_list_training_data`
List Chat AI training data files per WhatsApp device. Track file processing status.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `wa_id` | string | optional | — |
| `status` | string | optional | — |
| `limit` | number | optional | 50 |
| `offset` | number | optional | 0 |

---

## Perbandingan tool kedua server

| Kategori | Wajom | Dripsender | Beda |
|---|---|---|---|
| Users | `list_users`, `get_user` | `list_users`, `get_user` | Sama |
| Orders | `list_orders`, `get_order`, `order_stats`, `list_abandoned` | `list_orders`, `get_order`, `order_stats`, `list_abandoned`, **`list_token_purchases`** | Dripsender punya token purchases |
| Plans | `list_plans`, `get_plan` | `list_plans`, `get_plan` | Sama |
| Coupons | `list_coupons`, `get_coupon` | `list_coupons`, `get_coupon` | Sama |
| WhatsApp | `list_whatsapps`, `get_whatsapp`, `whatsapp_health` | `list_whatsapps`, `get_whatsapp`, `whatsapp_health` | Sama |
| Affiliate | `list_affiliates`, `get_affiliate` | `list_affiliates`, `get_affiliate` | Sama |
| Feedback | `list_feedbacks` | `list_feedbacks` | Sama |
| Activity | `user_activity` | `user_activity` | Sama |
| Class participants | **`list_class_participants`**, **`class_stats`** | — | Wajom only |
| Payouts | — | **`list_payouts`** | Dripsender only |
| Premium plugins | — | **`list_premium_plugins`**, **`list_user_plugins`** | Dripsender only |
| Website syncs | — | **`list_website_syncs`** | Dripsender only |
| Training data | — | **`list_training_data`** | Dripsender only |

## Konvensi

- **Prefix**: `wajom_` / `dripsender_` — tidak tabrakan walau kedua server jalan bersamaan
- **Pagination**: `limit` (default 50, max 200) + `offset` (default 0)
- **Date filter**: `date_from` / `date_to` — ISO-8601 (e.g. `2026-08-18` atau `2026-08-18T00:00:00Z`). Bare date di-extend ke end-of-day untuk `date_to`
- **Output**: JSON string. Timestamps → ISO-8601 UTC. PII di-strip (password, api_key, token)
- **Currency**: Wajom = MYR, Dripsender = IDR. Tidak ada konversi cross-currency
- **Read-only**: Semua tool. DB connection `readonly: true` + `query_only = 1`
