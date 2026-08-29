# LEVA Store — Manual Testing Checklist

**Branch:** `main` (changes committed to working tree, not yet pushed)
**Date prepared:** 2026-08-28
**Prerequisites:**
- Server running on `http://localhost:3000` (set `BASE_URL` env var if different)
- A valid admin JWT token (for admin-only endpoints)
- A valid cashier JWT token (for RBAC tests)
- `jq` installed (`brew install jq` / `choco install jq`) for response parsing
- `curl` available

Replace the placeholder values marked with `{{...}}` before running.

---

## Environment Setup

```bash
# Set these once at the top of your session
export BASE_URL="http://localhost:3000"
export ADMIN_TOKEN="{{YOUR_ADMIN_JWT_TOKEN}}"
export CASHIER_TOKEN="{{YOUR_CASHIER_JWT_TOKEN}}"
export PRODUCT_ID="{{AN_EXISTING_PRODUCT_ID}}"   # e.g. 1
```

---

## TEST 1: Aging Report — Basic Access (admin)

**What it tests:** The endpoint is reachable, returns 200, and has the correct shape.

```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$BASE_URL/api/v1/reports/aging" | jq .
```

**Expected response (200 OK):**
```json
{
  "success": true,
  "summary": {
    "totalBatches": <number>,
    "totalQty": <number>,
    "avgDaysInStock": <number>,
    "oldestBatch": { ... } | null,
    "nearExpiryCount": <number>,
    "filters": { "minDaysInStock": 0, "productId": null, "startDate": null, "endDate": null }
  },
  "data": [
    {
      "id": <number>,
      "productId": <number>,
      "productName": "<string>",
      "sku": "<string>",
      "batchNumber": "<string|null>",
      "qty": <number>,
      "costPrice": <number|null>,
      "receivedDate": "YYYY-MM-DD",
      "expireDate": "YYYY-MM-DD|null",
      "daysInStock": <number>,
      "daysUntilExpiry": <number|null>
    }
  ]
}
```

**Bug indicator:** Any of these:
- HTTP status is not 200
- `success` is `false`
- `data` is missing or not an array
- `summary` is missing any of: `totalBatches`, `totalQty`, `avgDaysInStock`, `oldestBatch`, `nearExpiryCount`
- Any item in `data` is missing `daysInStock` or `daysUntilExpiry`

---

## TEST 2: Aging Report — RBAC Enforcement (cashier must be blocked)

**What it tests:** Only admins can access the aging report. Cashiers get 403.

```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $CASHIER_TOKEN" \
  "$BASE_URL/api/v1/reports/aging"
```

**Expected response:** `403`

```bash
# Also confirm the body says access denied
curl -s \
  -H "Authorization: Bearer $CASHIER_TOKEN" \
  "$BASE_URL/api/v1/reports/aging" | jq .
```

**Expected body:**
```json
{
  "message": "Access denied. Required role: admin"
}
```

**Bug indicator:**
- HTTP status is 200 (data leaked to cashier)
- HTTP status is 401 (wrong — the token is valid, the role check should return 403)

---

## TEST 3: Aging Report — Sort Order (oldest receivedDate first)

**What it tests:** The `data` array is sorted by `receivedDate` ascending.

```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$BASE_URL/api/v1/reports/aging" \
  | jq -r '.data[].receivedDate'
```

**Expected:** A list of dates in ascending (oldest-first) order. Visually confirm
the first line is the earliest date and the last line is the most recent.

```bash
# One-liner that exits non-zero if the array is NOT sorted ascending
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$BASE_URL/api/v1/reports/aging" \
  | jq -e '[.data[].receivedDate] | sort == .'
```

**Expected:** Exit code 0 (the jq `-e` flag means: exit 1 if the result is `false`).

**Bug indicator:** Exit code 1 (array is not sorted oldest-first).

---

## TEST 4: Aging Report — Filters

### TEST 4a: `?minDaysInStock=30`

```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$BASE_URL/api/v1/reports/aging?minDaysInStock=30" \
  | jq '[.data[] | select(.daysInStock < 30)] | length'
```

**Expected:** `0` (no items with daysInStock < 30 should pass the filter).

**Bug indicator:** A number > 0 (filter is not working).

**Sanity check — also verify total is reasonable:**
```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$BASE_URL/api/v1/reports/aging?minDaysInStock=30" \
  | jq '{ total: .summary.totalBatches, minDays: .summary.filters.minDaysInStock }'
```

---

### TEST 4b: `?productId=X`

```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$BASE_URL/api/v1/reports/aging?productId=$PRODUCT_ID" \
  | jq '[.data[] | select(.productId != '$PRODUCT_ID')] | length'
```

**Expected:** `0` (every item must belong to the specified product).

**Bug indicator:** A number > 0.

**Sanity check:**
```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$BASE_URL/api/v1/reports/aging?productId=$PRODUCT_ID" \
  | jq '{ count: .summary.totalBatches, productId: .summary.filters.productId }'
```

---

### TEST 4c: `?startDate` and `?endDate`

```bash
# Use dates that you know contain batches. Example: last 60 days
START=$(date -d "60 days ago" +%Y-%m-%d)
END=$(date +%Y-%m-%d)

curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$BASE_URL/api/v1/reports/aging?startDate=$START&endDate=$END" \
  | jq '[.data[] | select(.receivedDate < "'$START'" or .receivedDate > "'$END'")] | length'
```

**Expected:** `0` (every `receivedDate` must fall within the range).

**Bug indicator:** A number > 0.

---

## TEST 5: Dashboard Widget (`nearExpiryCount` and `oldStockCount`)

### TEST 5a: Confirm fields exist and are numbers

```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$BASE_URL/api/v1/dashboard/summary" \
  | jq '{ nearExpiryCount: .data.nearExpiryCount, oldStockCount: .data.oldStockCount }'
```

**Expected:**
```json
{
  "nearExpiryCount": <non-null integer>,
  "oldStockCount": <non-null integer>
}
```

**Bug indicator:**
- `nearExpiryCount` is `null` or missing
- `oldStockCount` is `null` or missing
- Either is a string or non-integer

---

### TEST 5b: Create a near-expiry test batch and verify `nearExpiryCount` increments

**Step 1 — Note the current count:**
```bash
echo "Before: $(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$BASE_URL/api/v1/dashboard/summary" | jq '.data.nearExpiryCount')"
```

**Step 2 — Create a product with a batch expiring in 3 days:**

First, get today's date and compute the expiry date:

```bash
# Bash (Linux/Mac/Git Bash):
EXPIRY=$(date -d "+3 days" +%Y-%m-%d)

# PowerShell (Windows):
# $expiry = (Get-Date).AddDays(3).ToString("yyyy-MM-dd")
```

Then create the batch via `POST /api/v1/products/{PRODUCT_ID}/batches`:

```bash
curl -s -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  "$BASE_URL/api/v1/products/$PRODUCT_ID/batches" \
  -d '{
    "qty": 10,
    "expire_date": "'$EXPIRY'",
    "batch_number": "TEST-NEAR-EXPIRY",
    "cost_price": 1.00
  }' | jq .
```

**Expected:** `"success": true` with the new batch data.

**Step 3 — Re-check the dashboard:**
```bash
echo "After:  $(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$BASE_URL/api/v1/dashboard/summary" | jq '.data.nearExpiryCount')"
```

**Expected:** The "After" value = "Before" value + 1.

**Bug indicator:** Count did not increase by 1.

---

### TEST 5c: Create an old-stock test batch and verify `oldStockCount` increments

**Step 1 — Note the current count:**
```bash
echo "Before: $(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$BASE_URL/api/v1/dashboard/summary" | jq '.data.oldStockCount')"
```

**Step 2 — Create a product with a batch received 40 days ago:**

```bash
# Bash:
RECEIVED=$(date -d "40 days ago" +%Y-%m-%d)

# PowerShell:
# $received = (Get-Date).AddDays(-40).ToString("yyyy-MM-dd")
```

```bash
curl -s -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  "$BASE_URL/api/v1/products/$PRODUCT_ID/batches" \
  -d '{
    "qty": 10,
    "expire_date": null,
    "batch_number": "TEST-OLD-STOCK",
    "cost_price": 1.00
  }' | jq .
```

**Step 3 — Now update that batch's `receivedDate` to 40 days ago.**

The batch creation endpoint sets `receivedDate` to today automatically. You need
to either:
  (a) Use a DB client to update it directly:
```sql
UPDATE "ProductBatches"
SET received_date = CURRENT_DATE - INTERVAL '40 days'
WHERE batch_number = 'TEST-OLD-STOCK';
```
  OR
  (b) Use the batch update endpoint if one exists in your routes.

**Step 4 — Re-check:**
```bash
echo "After:  $(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$BASE_URL/api/v1/dashboard/summary" | jq '.data.oldStockCount')"
```

**Expected:** The "After" value = "Before" value + 1.

**Bug indicator:** Count did not increase by 1.

**Cleanup (optional — do this after confirming):**
```bash
# Delete the test batches via the DELETE endpoint or DB client
# DELETE /api/v1/products/batches/{BATCH_ID}
```

---

## TEST 6: FEFO Fix — The Critical Bug Scenario

This test reproduces the exact bug that existed before the fix: when a product
has an expired batch with stock, `PATCH /:id/stock/out` should NOT deduct from
the expired batch — it should only touch valid (non-expired) batches.

### Step 1 — Create a product with two batches

```bash
# ── Create the product ──────────────────────────────────────
curl -s -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  "$BASE_URL/api/v1/products" \
  -d '{
    "name": "FEFO-TEST-PRODUCT",
    "sku": "FEFO-001",
    "price": 5.00,
    "costPrice": 3.00,
    "categoryId": 1
  }' | jq '{ id: .data.id, name: .data.name }'
```

Copy the returned `id` — use it as `FEFO_PRODUCT_ID`.

### Step 2 — Create Batch A (expired yesterday)

```bash
FEFO_PRODUCT_ID="{{ID_FROM_STEP_1}}"
EXPIRED_DATE=$(date -d "yesterday" +%Y-%m-%d)
# PowerShell: $expired = (Get-Date).AddDays(-1).ToString("yyyy-MM-dd")

curl -s -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  "$BASE_URL/api/v1/products/$FEFO_PRODUCT_ID/batches" \
  -d '{
    "qty": 10,
    "expire_date": "'$EXPIRED_DATE'",
    "batch_number": "FEFO-BATCH-A-EXPIRED",
    "cost_price": 2.00
  }' | jq '{ batchId: .data.id, qty: .data.qty, expireDate: .data.expireDate }'
```

Copy the returned `id` as `BATCH_A_ID`.

### Step 3 — Create Batch B (valid, expires in 30 days)

```bash
VALID_DATE=$(date -d "+30 days" +%Y-%m-%d)
# PowerShell: $valid = (Get-Date).AddDays(30).ToString("yyyy-MM-dd")

curl -s -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  "$BASE_URL/api/v1/products/$FEFO_PRODUCT_ID/batches" \
  -d '{
    "qty": 10,
    "expire_date": "'$VALID_DATE'",
    "batch_number": "FEFO-BATCH-B-VALID",
    "cost_price": 2.00
  }' | jq '{ batchId: .data.id, qty: .data.qty, expireDate: .data.expireDate }'
```

Copy the returned `id` as `BATCH_B_ID`.

### Step 4 — Confirm both batches exist and have correct quantities

```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$BASE_URL/api/v1/products/$FEFO_PRODUCT_ID/batches" | jq '.data[] | { id, batchNumber, qty, expireDate }'
```

**Expected output:**
```json
{ "id": <BATCH_A_ID>, "batchNumber": "FEFO-BATCH-A-EXPIRED",  "qty": 10, "expireDate": "<yesterday>" }
{ "id": <BATCH_B_ID>, "batchNumber": "FEFO-BATCH-B-VALID",   "qty": 10, "expireDate": "<30 days from now>" }
```

---

### Step 5 — Deduct 5 units via stock-out

```bash
curl -s -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  "$BASE_URL/api/v1/products/$FEFO_PRODUCT_ID/stock/out" \
  -d '{"qty": 5}' | jq .
```

**Expected response (200 OK):**
```json
{
  "success": true,
  "message": "...",
  "data": {
    "productId": <FEFO_PRODUCT_ID>,
    "oldQty": 20,
    "outQty": 5,
    "newQty": 15,
    "affectedBatches": [
      { "batchId": <BATCH_B_ID>, "deducted": 5, "remaining": 5 }
    ]
  }
}
```

**Bug indicator:**
- HTTP status is not 200
- `affectedBatches` contains `BATCH_A_ID` (the expired batch was touched)
- `success` is `false`

---

### Step 6 — Verify Batch A (expired) was NOT touched

```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$BASE_URL/api/v1/batches/$BATCH_A_ID" | jq '.data | { id, batchNumber, qty, expireDate }'
```

**Expected:**
```json
{ "id": <BATCH_A_ID>, "batchNumber": "FEFO-BATCH-A-EXPIRED", "qty": 10, "expireDate": "<yesterday>" }
```

**qty must still be 10.** This is the critical assertion — if qty dropped to 5,
the fix did not work.

---

### Step 7 — Verify Batch B (valid) WAS deducted from

```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$BASE_URL/api/v1/batches/$BATCH_B_ID" | jq '.data | { id, batchNumber, qty, expireDate }'
```

**Expected:**
```json
{ "id": <BATCH_B_ID>, "batchNumber": "FEFO-BATCH-B-VALID", "qty": 5, "expireDate": "<30 days from now>" }
```

**qty must be 5** (was 10, deducted 5).

---

### Step 8 — Confirm product total is correct

```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$BASE_URL/api/v1/products/$FEFO_PRODUCT_ID" | jq '.data | { id, name, qty }'
```

**Expected:** `qty: 15` (10 remaining in Batch A + 5 remaining in Batch B).

---

### Cleanup (IMPORTANT — remove test data)

```bash
# Delete the test product (cascades to batches via FK)
curl -s -X DELETE \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$BASE_URL/api/v1/products/$FEFO_PRODUCT_ID" | jq .
```

**Expected:** `"success": true`

---

## TEST 7: Regression Check — Normal Checkout Still Works

This confirms the fix to `deductStockFifo` did not break the already-working
`allocateBatchesToOrderDetail` path (the one used during checkout).

### Step 1 — Set up a product with two valid batches

```bash
# Create product
TEST_PROD=$(curl -s -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  "$BASE_URL/api/v1/products" \
  -d '{
    "name": "REGRESSION-TEST",
    "sku": "REG-001",
    "price": 5.00,
    "costPrice": 3.00,
    "categoryId": 1
  }' | jq -r '.data.id')

echo "Product ID: $TEST_PROD"

# Batch A — expires in 30 days, qty 10
VALID_A=$(date -d "+30 days" +%Y-%m-%d)
curl -s -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  "$BASE_URL/api/v1/products/$TEST_PROD/batches" \
  -d "{\"qty\": 10, \"expire_date\": \"$VALID_A\", \"batch_number\": \"REG-A\", \"cost_price\": 2.00}" | jq .

# Batch B — expires in 60 days, qty 10
VALID_B=$(date -d "+60 days" +%Y-%m-%d)
curl -s -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  "$BASE_URL/api/v1/products/$TEST_PROD/batches" \
  -d "{\"qty\": 10, \"expire_date\": \"$VALID_B\", \"batch_number\": \"REG-B\", \"cost_price\": 2.00}" | jq .
```

### Step 2 — Get an existing customer (or create one)

```bash
# List customers to find one to use
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$BASE_URL/api/v1/customers?limit=1" | jq '.data[0] | { id, firstName, lastName }'
```

Copy a customer `id` as `CUSTOMER_ID`.

### Step 3 — Create an order (PENDING — no stock deducted yet)

```bash
curl -s -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  "$BASE_URL/api/v1/orders" \
  -d '{
    "customerId": '$CUSTOMER_ID',
    "items": [{ "productId": '$TEST_PROD', "qty": 15 }],
    "discount": 0,
    "currency": "USD"
  }' | jq '{ orderId: .data.id, status: .data.status }'
```

Copy the returned `id` as `ORDER_ID`.

**Expected:** `"status": "PENDING"` (stock not yet deducted).

### Step 4 — Confirm the order (this triggers `allocateBatchesToOrderDetail`)

```bash
curl -s -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  "$BASE_URL/api/v1/orders/$ORDER_ID/confirm" | jq .
```

**Expected:** `"success": true` and order status `"COMPLETED"`.

### Step 5 — Verify FEFO allocation (Batch A consumed first, Batch B second)

```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$BASE_URL/api/v1/products/$TEST_PROD/batches" | jq '.data[] | { batchNumber, qty }'
```

**Expected:**
```
Batch "REG-A" (soonest expiry, 30 days): qty = 0  (fully consumed — 10 of 15)
Batch "REG-B" (later expiry, 60 days):   qty = 5  (partially consumed — 5 of 15)
```

This confirms the existing checkout path still uses FEFO correctly.

### Step 6 — Verify product total is correct

```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$BASE_URL/api/v1/products/$TEST_PROD" | jq '.data | { id, name, qty }'
```

**Expected:** `qty: 5`

### Cleanup

```bash
curl -s -X DELETE \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$BASE_URL/api/v1/products/$TEST_PROD" | jq .
```

**Expected:** `"success": true`

If the customer was created just for this test, delete them too:
```bash
curl -s -X DELETE \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$BASE_URL/api/v1/customers/$CUSTOMER_ID" | jq .
```

---

## Quick Reference — All Endpoints Used

| Method | URL | Purpose |
|--------|-----|---------|
| GET | `/api/v1/reports/aging` | Aging report (TEST 1–4) |
| GET | `/api/v1/dashboard/summary` | Dashboard summary (TEST 5) |
| POST | `/api/v1/products/{id}/batches` | Create batch (TEST 5, 6, 7) |
| GET | `/api/v1/products/{id}/batches` | List product's batches (TEST 6, 7) |
| GET | `/api/v1/batches/{batchId}` | Get single batch (TEST 6) |
| PATCH | `/api/v1/products/{id}/stock/out` | Manual stock-out (TEST 6) |
| POST | `/api/v1/orders` | Create order (TEST 7) |
| POST | `/api/v1/orders/{id}/confirm` | Confirm order → FEFO deduction (TEST 7) |
| GET | `/api/v1/products/{id}` | Get product qty (TEST 6, 7) |
| DELETE | `/api/v1/products/{id}` | Delete product + cascade (cleanup) |
| DELETE | `/api/v1/customers/{id}` | Delete customer (cleanup) |

---

## Checklist

```
TEST 1: Aging report — basic access
  [ ] 200 OK, success: true, data is array, summary has all required fields

TEST 2: Aging report — RBAC enforcement
  [ ] Cashier gets 403 (not 200, not 401)

TEST 3: Aging report — sort order
  [ ] jq sort-equality check exits 0 (data is oldest-receivedDate-first)

TEST 4a: Aging report — minDaysInStock filter
  [ ] No items with daysInStock < 30 in response

TEST 4b: Aging report — productId filter
  [ ] Every item has the requested productId

TEST 4c: Aging report — startDate/endDate filter
  [ ] Every receivedDate falls within the range

TEST 5a: Dashboard widget — fields present
  [ ] nearExpiryCount and oldStockCount are non-null integers

TEST 5b: Dashboard widget — nearExpiryCount increments
  [ ] Created near-expiry batch → nearExpiryCount increased by 1

TEST 5c: Dashboard widget — oldStockCount increments
  [ ] Created 40-day-old batch → oldStockCount increased by 1

TEST 6: FEFO fix — expired batch NOT touched by stock-out
  [ ] Batch A (expired yesterday) qty stays at 10
  [ ] Batch B (valid) qty drops from 10 to 5
  [ ] Product total = 15 (10 + 5)
  [ ] Cleanup: test product deleted

TEST 7: Regression — normal checkout FEFO
  [ ] Batch A (soonest expiry) fully consumed (qty → 0)
  [ ] Batch B (later expiry) partially consumed (qty → 5)
  [ ] Product total = 5
  [ ] Cleanup: test product + customer deleted
```
