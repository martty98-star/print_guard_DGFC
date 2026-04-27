'use strict';

function cleanString(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function toIsoOrNull(value) {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

function firstCleanString(values) {
  for (const value of values) {
    const cleaned = cleanString(value);
    if (cleaned) return cleaned;
  }
  return null;
}

function normalizeBrandCode(value) {
  const cleaned = cleanString(value);
  return cleaned ? cleaned.toLowerCase() : null;
}

function prefixOrderNumberForBrand(orderNumber, brandCode) {
  const cleaned = cleanString(orderNumber);
  const brand = normalizeBrandCode(brandCode);
  if (!cleaned) return null;
  if (brand === 'ps' && !/^ps/i.test(cleaned)) return `PS${cleaned}`;
  return cleaned;
}

function resolveOrderNumber(order) {
  if (!order || typeof order !== 'object') return null;
  const brand = order.order && typeof order.order === 'object'
    ? order.order.brand_system_code
    : order.brand_system_code;
  const ecommerceId = firstCleanString([
    order.order && order.order.ecommerce_id,
    order.order && order.order.ecommerceId,
    order.ecommerce_id,
    order.ecommerceId,
    order.document_id,
    order.documentId,
  ]);
  if (ecommerceId) return prefixOrderNumberForBrand(ecommerceId, brand);

  return prefixOrderNumberForBrand(firstCleanString([
    order.order_number,
    order.orderNumber,
    order.order_no,
    order.orderNo,
    order.number,
    order.name,
    order.reference,
    order.order_reference,
    order.orderReference,
    order.purchase_order_number,
    order.purchaseOrderNumber,
    order.purchase_order_no,
    order.purchaseOrderNo,
    order.customer_order_number,
    order.customerOrderNumber,
    order.customer_reference,
    order.customerReference,
    order.client_order_number,
    order.clientOrderNumber,
    order.po_number,
    order.poNumber,
    order.order && order.order.number,
    order.order && order.order.orderNumber,
    order.order && order.order.reference,
    order.purchaseOrder && order.purchaseOrder.number,
    order.purchaseOrder && order.purchaseOrder.orderNumber,
    order.purchaseOrder && order.purchaseOrder.reference,
  ]), brand);
}

function resolveBrand(order) {
  return cleanString(
    order && (
      order.brand_system_code ||
      order.brandSystemCode ||
      (order.order && order.order.brand_system_code) ||
      (order.order && order.order.brandSystemCode)
    )
  );
}

function resolveApiOrderId(order) {
  return cleanString(
    order && (
      order.id ||
      order.rawId ||
      order.external_order_id ||
      order.externalOrderId ||
      order.uuid
    )
  );
}

function getOrderCreatedAt(order) {
  return toIsoOrNull(
    order && (
      order.created_at ||
      order.createdAt ||
      order.received_at ||
      order.receivedAt ||
      order.updated_at ||
      order.updatedAt
    )
  );
}

function mapPostPurchaseOrder(order) {
  return {
    orderNumber: resolveOrderNumber(order),
    brand: resolveBrand(order),
    createdAt: getOrderCreatedAt(order),
    supplier: cleanString(order && (order.supplier_system_code || order.supplierSystemCode)),
    rawId: Number(order && order.id) || null,
  };
}

function getNewestCreatedAt(orders) {
  const timestamps = (orders || [])
    .map((order) => getOrderCreatedAt(order))
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));
  if (!timestamps.length) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}

function getEnvValue(name) {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

function getPostPurchaseConfig(overrides) {
  const baseUrl = cleanString(overrides && overrides.baseUrl) || getEnvValue('POST_PURCHASE_API_BASE_URL');
  const token = cleanString(overrides && overrides.token) || getEnvValue('POST_PURCHASE_API_TOKEN');
  const ordersPath = cleanString(overrides && overrides.ordersPath) || getEnvValue('POST_PURCHASE_API_ORDERS_PATH');
  const supplierSystemCode =
    cleanString(overrides && overrides.supplierSystemCode) ||
    getEnvValue('POST_PURCHASE_API_SUPPLIER_SYSTEM_CODE') ||
    'desenio_dgfc_printer';
  return { baseUrl, token, ordersPath, supplierSystemCode };
}

function assertPostPurchaseConfig(config) {
  if (!config.baseUrl) {
    throw new Error('Missing POST_PURCHASE_API_BASE_URL');
  }
  let parsedBaseUrl;
  try {
    parsedBaseUrl = new URL(config.baseUrl);
  } catch (error) {
    throw new Error('Invalid POST_PURCHASE_API_BASE_URL');
  }
  if (!/^https?:$/.test(parsedBaseUrl.protocol)) {
    throw new Error('POST_PURCHASE_API_BASE_URL must start with http:// or https://');
  }
  if (!parsedBaseUrl.hostname || /^base$/i.test(parsedBaseUrl.hostname)) {
    throw new Error('POST_PURCHASE_API_BASE_URL must be https://post-purchase.desen.io');
  }
  if (!config.token) {
    throw new Error('Missing POST_PURCHASE_API_TOKEN');
  }
  if (/^REPLACE_WITH_/i.test(config.token)) {
    throw new Error('POST_PURCHASE_API_TOKEN still contains the placeholder value');
  }
}

function buildCandidateUrls(baseUrl, ordersPath) {
  let base;
  try {
    base = new URL(baseUrl);
  } catch (error) {
    throw new Error('Invalid POST_PURCHASE_API_BASE_URL');
  }

  const explicitPath = cleanString(ordersPath);
  const candidates = [];
  const currentPath = cleanString(base.pathname);
  const includeCurrent = currentPath && currentPath !== '/' && !/\/docs(\/|$)/i.test(currentPath);

  if (explicitPath) {
    candidates.push(new URL(explicitPath, base).toString());
  } else {
    if (includeCurrent) {
      candidates.push(base.toString());
    }

    [
      '/api/purchase-order/get',
      '/print-orders',
      '/orders',
      '/api/print-orders',
      '/api/orders',
      '/v1/print-orders',
      '/v1/orders',
    ].forEach((path) => {
      candidates.push(new URL(path, base).toString());
    });
  }

  return [...new Set(candidates)];
}

function applyFilterParams(targetUrl, options, pageState) {
  const url = new URL(targetUrl);
  const params = url.searchParams;
  const updatedFrom = cleanString(options && (options.updatedFrom || options.since));
  const createdFrom = cleanString(options && options.createdFrom);
  const limit = Math.max(1, Math.min(100, Number(options && (options.limit || options.pageSize)) || 100));
  const fromId = Math.max(0, Number(pageState && pageState.fromId) || 0);
  const cursor = cleanString(pageState && pageState.cursor);
  const supplierSystemCode = cleanString(options && options.supplierSystemCode);

  if (updatedFrom) {
    ['updated_from', 'updatedFrom', 'updated_since', 'updatedSince'].forEach((key) => {
      if (!params.has(key)) params.set(key, updatedFrom);
    });
  }

  if (createdFrom) {
    ['created_from', 'createdFrom', 'created_since', 'createdSince'].forEach((key) => {
      if (!params.has(key)) params.set(key, createdFrom);
    });
  }

  params.set('limit', String(limit));
  params.delete('fromid');
  params.set('fromId', String(fromId));
  if (supplierSystemCode && !params.has('supplierSystemCode')) {
    params.set('supplierSystemCode', supplierSystemCode);
  }

  if (cursor) {
    ['cursor', 'page_token', 'pageToken', 'next_cursor', 'nextCursor'].forEach((key) => {
      if (!params.has(key)) params.set(key, cursor);
    });
  }

  return url;
}

async function fetchJsonOrThrow(url, token, fetchImpl) {
  const response = await fetchImpl(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  const rawText = await response.text();
  let payload = null;
  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch (error) {
      const invalidJsonError = new Error(`Invalid JSON from Post Purchase API (${url})`);
      invalidJsonError.statusCode = response.status;
      invalidJsonError.responseText = rawText.slice(0, 500);
      invalidJsonError.cause = error;
      throw invalidJsonError;
    }
  }

  if (!response.ok) {
    const apiError = new Error(`Post Purchase API request failed (${response.status} ${response.statusText})`);
    apiError.statusCode = response.status;
    apiError.payload = payload;
    apiError.responseText = rawText.slice(0, 500);
    throw apiError;
  }

  return payload;
}

function extractOrdersArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return null;

  const candidates = [
    payload.data,
    payload.items,
    payload.results,
    payload.orders,
    payload.order,
    payload.purchase_orders,
    payload.purchaseOrders,
    payload.purchase_order,
    payload.purchaseOrder,
    payload.purchaseOrderList,
    payload.purchase_order_list,
    payload.print_orders,
    payload.printOrders,
    payload.records,
    payload.payload,
    payload.response,
    payload.result,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (candidate && typeof candidate === 'object') {
      if (Array.isArray(candidate.items)) return candidate.items;
      if (Array.isArray(candidate.data)) return candidate.data;
      if (Array.isArray(candidate.orders)) return candidate.orders;
      if (Array.isArray(candidate.results)) return candidate.results;
      if (Array.isArray(candidate.purchase_orders)) return candidate.purchase_orders;
      if (Array.isArray(candidate.purchaseOrders)) return candidate.purchaseOrders;
      if (Array.isArray(candidate.purchaseOrderList)) return candidate.purchaseOrderList;
      if (Array.isArray(candidate.purchase_order_list)) return candidate.purchase_order_list;
      if (Array.isArray(candidate.records)) return candidate.records;
      if (Array.isArray(candidate.payload)) return candidate.payload;
    }
  }

  return null;
}

function describePayloadShape(payload) {
  if (Array.isArray(payload)) return `array(${payload.length})`;
  if (!payload || typeof payload !== 'object') return typeof payload;
  const keys = Object.keys(payload).slice(0, 20);
  const summary = {};
  keys.forEach((key) => {
    const value = payload[key];
    if (Array.isArray(value)) {
      summary[key] = `array(${value.length})`;
    } else if (value && typeof value === 'object') {
      summary[key] = `object(${Object.keys(value).slice(0, 12).join(',')})`;
    } else {
      summary[key] = typeof value;
    }
  });
  return JSON.stringify(summary).slice(0, 500);
}

function resolveNextPage(payload, currentUrl, pageState, itemCount) {
  const items = extractOrdersArray(payload) || [];
  const itemIds = items
    .map((item) => Number(item && (item.id || item.external_order_id || item.externalOrderId)))
    .filter((value) => Number.isFinite(value) && value > 0);
  const maxItemId = itemIds.length ? Math.max(...itemIds) : 0;
  const lastItemId = itemIds.length ? itemIds[itemIds.length - 1] : 0;
  const limit = Math.max(1, Math.min(100, Number(new URL(currentUrl).searchParams.get('limit')) || 100));
  const currentFromId = Math.max(0, Number(pageState && pageState.fromId) || 0);

  if (lastItemId > 0 && lastItemId !== currentFromId && itemCount >= limit) {
    return { fromId: lastItemId };
  }
  if (maxItemId > 0 && itemCount > 0 && itemCount < limit) {
    return null;
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const nextUrl = [
    payload.next,
    payload.next_page_url,
    payload.nextPageUrl,
    payload.links && payload.links.next,
    payload.pagination && payload.pagination.next,
    payload.pagination && payload.pagination.next_url,
    payload.meta && payload.meta.next,
    payload.meta && payload.meta.next_page_url,
  ].find((value) => typeof value === 'string' && value.trim());

  if (nextUrl) {
    return { absoluteUrl: new URL(nextUrl, currentUrl).toString() };
  }

  const nextCursor = [
    payload.next_cursor,
    payload.nextCursor,
    payload.pagination && payload.pagination.next_cursor,
    payload.pagination && payload.pagination.nextCursor,
    payload.meta && payload.meta.next_cursor,
    payload.meta && payload.meta.nextCursor,
  ].find((value) => typeof value === 'string' && value.trim());

  if (nextCursor) {
    return { cursor: nextCursor };
  }

  const nextPage = [
    payload.next_page,
    payload.nextPage,
    payload.pagination && payload.pagination.next_page,
    payload.pagination && payload.pagination.nextPage,
    payload.meta && payload.meta.next_page,
    payload.meta && payload.meta.nextPage,
  ].find((value) => Number.isInteger(Number(value)) && Number(value) > 0);

  if (nextPage) {
    return { page: Number(nextPage) };
  }

  const hasMore = payload.has_more === true || payload.hasMore === true;
  if (hasMore && lastItemId > 0 && lastItemId !== currentFromId) return { fromId: lastItemId };

  return null;
}

function getLastApiId(orders) {
  const ids = (orders || [])
    .map((item) => Number(item && (item.id || item.external_order_id || item.externalOrderId)))
    .filter((value) => Number.isFinite(value) && value > 0);
  return ids.length ? ids[ids.length - 1] : null;
}

function normalizeOrder(order) {
  const mapped = mapPostPurchaseOrder(order);
  const externalOrderId = resolveApiOrderId(order) || mapped.orderNumber;

  if (!externalOrderId) {
    return null;
  }

  return {
    external_order_id: externalOrderId,
    order_number: mapped.orderNumber,
    customer_order_id: cleanString(order.customer_order_id || order.customerOrderId || order.customer_id || order.customerId || order.document_id || order.documentId),
    status: cleanString(order.status || order.order_status || order.orderStatus),
    received_at: mapped.createdAt,
    source_payload: order,
  };
}

async function fetchPostPurchaseOrders(options) {
  const config = getPostPurchaseConfig(options);
  assertPostPurchaseConfig(config);

  const fetchImpl = options && options.fetchImpl ? options.fetchImpl : global.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch API is not available in this Node runtime');
  }

  const log = options && typeof options.log === 'function' ? options.log : console.log;
  const urlsToTry = buildCandidateUrls(config.baseUrl, config.ordersPath);
  const maxPages = Math.max(1, Number(options && options.maxPages) || 100);
  const requestOptions = {
    ...(options || {}),
    supplierSystemCode: config.supplierSystemCode,
  };
  let lastDiscoveryError = null;

  for (const candidate of urlsToTry) {
    const seenUrls = new Set();
    const pages = [];
    let pageState = { page: 1, fromId: Math.max(0, Number(options && options.fromId) || 0) };
    let currentUrl = candidate;

    try {
      for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
        const requestUrl = pageState.absoluteUrl
          ? new URL(pageState.absoluteUrl)
          : applyFilterParams(currentUrl, requestOptions, pageState);

        const requestKey = requestUrl.toString();
        if (seenUrls.has(requestKey)) {
          break;
        }
        seenUrls.add(requestKey);

        log(`[postpurchase] fetch page=${pageIndex + 1} ${requestKey}`);
        const payload = await fetchJsonOrThrow(requestUrl, config.token, fetchImpl);
        const items = extractOrdersArray(payload);
        if (!Array.isArray(items)) {
          throw new Error(`Unsupported Post Purchase API response shape for ${requestKey}: ${describePayloadShape(payload)}`);
        }

        pages.push(...items);
        const newestCreatedAt = getNewestCreatedAt(pages);
        const lastApiId = getLastApiId(items);
        log(`[postpurchase] page=${pageIndex + 1} records=${items.length} total=${pages.length}${lastApiId ? ` last_id=${lastApiId}` : ''}${newestCreatedAt ? ` newest_created_at=${newestCreatedAt}` : ''}`);
        const nextPage = resolveNextPage(payload, requestUrl, pageState, items.length);
        if (nextPage && nextPage.fromId) {
          log(`[postpurchase] nextFromId=${nextPage.fromId}`);
        }
        if (!nextPage) {
          return { endpoint: requestKey, orders: pages, newestCreatedAt: getNewestCreatedAt(pages) };
        }

        currentUrl = requestUrl.toString();
        pageState = nextPage;
      }

      return { endpoint: currentUrl, orders: pages, newestCreatedAt: getNewestCreatedAt(pages) };
    } catch (error) {
      const canContinueDiscovery =
        !cleanString(config.ordersPath) &&
        (
          (error && error.statusCode === 404) ||
          /Invalid JSON from Post Purchase API/i.test(String(error && error.message || '')) ||
          /Unsupported Post Purchase API response shape/i.test(String(error && error.message || ''))
        );
      if (canContinueDiscovery) {
        lastDiscoveryError = error;
        continue;
      }
      throw error;
    }
  }

  throw lastDiscoveryError || new Error('Unable to resolve Post Purchase API orders endpoint');
}

async function ensurePrintOrdersTable(client) {
  await client.query(
    `
      create table if not exists print_orders_received (
        id bigserial primary key,
        external_order_id text not null unique,
        order_number text null,
        customer_order_id text null,
        status text null,
        source_payload jsonb not null,
        received_at timestamptz null,
        api_seen_at timestamptz not null default now(),
        submit_tool_processed_at timestamptz null,
        onyx_seen_at timestamptz null,
        colorado_printed_at timestamptz null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `
  );

  await client.query(
    `create index if not exists print_orders_received_status_idx on print_orders_received (status)`
  );

  await client.query(
    `create index if not exists print_orders_received_received_at_idx on print_orders_received (received_at desc nulls last)`
  );
}

async function getLastSeenApiId(client) {
  await ensurePrintOrdersTable(client);
  const result = await client.query(
    `
      select coalesce(
        max(
          case
            when external_order_id ~ '^[0-9]+$' then external_order_id::bigint
            when source_payload->>'id' ~ '^[0-9]+$' then (source_payload->>'id')::bigint
            else null
          end
        ),
        0
      ) as last_seen_api_id
      from print_orders_received
    `
  );

  return Number(result.rows[0] && result.rows[0].last_seen_api_id) || 0;
}

async function upsertPrintOrders(client, orders, options) {
  await ensurePrintOrdersTable(client);

  const log = options && typeof options.log === 'function' ? options.log : console.log;
  const stats = {
    fetched: Array.isArray(orders) ? orders.length : 0,
    normalized: 0,
    skipped: 0,
    inserted: 0,
    updated: 0,
  };

  const normalizedOrders = [];
  const seenExternalIds = new Set();

  for (const rawOrder of orders || []) {
    const normalized = normalizeOrder(rawOrder);
    if (!normalized || !normalized.external_order_id) {
      stats.skipped += 1;
      continue;
    }
    if (seenExternalIds.has(normalized.external_order_id)) {
      stats.skipped += 1;
      continue;
    }
    seenExternalIds.add(normalized.external_order_id);
    normalizedOrders.push(normalized);
  }

  stats.normalized = normalizedOrders.length;

  for (const order of normalizedOrders) {
    const result = await client.query(
      `
        insert into print_orders_received (
          external_order_id,
          order_number,
          customer_order_id,
          status,
          source_payload,
          received_at,
          api_seen_at,
          updated_at
        )
        values ($1, $2, $3, $4, $5::jsonb, $6::timestamptz, now(), now())
        on conflict (external_order_id) do update
        set
          order_number = excluded.order_number,
          customer_order_id = excluded.customer_order_id,
          status = excluded.status,
          source_payload = excluded.source_payload,
          received_at = coalesce(excluded.received_at, print_orders_received.received_at),
          api_seen_at = now(),
          updated_at = now()
        returning (xmax = 0) as inserted
      `,
      [
        order.external_order_id,
        order.order_number,
        order.customer_order_id,
        order.status,
        JSON.stringify(order.source_payload),
        order.received_at,
      ]
    );

    if (result.rows[0] && result.rows[0].inserted) {
      stats.inserted += 1;
    } else {
      stats.updated += 1;
    }
  }

  log(`[postpurchase] fetched=${stats.fetched} normalized=${stats.normalized} inserted=${stats.inserted} updated=${stats.updated} skipped=${stats.skipped}`);
  return stats;
}

async function syncPostPurchaseOrders(client, options) {
  const log = options && typeof options.log === 'function' ? options.log : console.log;
  const explicitFromId = options && options.fromId != null;
  const filteredResync = Boolean(options && (options.updatedFrom || options.createdFrom || options.since));
  const fromId = explicitFromId
    ? Math.max(0, Number(options.fromId) || 0)
    : filteredResync
      ? 0
      : await getLastSeenApiId(client);
  const fetched = await fetchPostPurchaseOrders({
    ...options,
    fromId,
  });

  if (!fetched.orders.length) {
    log('[postpurchase] no orders returned from API');
  }

  const stats = await upsertPrintOrders(client, fetched.orders, options);
  return {
    endpoint: fetched.endpoint,
    fromId,
    newestCreatedAt: fetched.newestCreatedAt,
    ...stats,
  };
}

module.exports = {
  fetchPostPurchaseOrders,
  syncPostPurchaseOrders,
};
