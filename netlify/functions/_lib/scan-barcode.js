'use strict';

const ORDER_TYPE_SUFFIXES = new Set(['S', 'C', 'R', 'RS', 'RC']);

function cleanScanText(value) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function reprintKindForOrderType(orderType) {
  if (orderType === 'RS') return 'single';
  if (orderType === 'RC') return 'combi';
  if (orderType === 'R') return 'unknown';
  return null;
}

function stripCode39Stars(value) {
  return cleanScanText(value).replace(/^\*+/, '').replace(/\*+$/, '').trim();
}

function parseBarcode(value) {
  const rawBarcode = cleanScanText(value);
  const normalizedBarcode = stripCode39Stars(rawBarcode);
  if (!normalizedBarcode) {
    return {
      ok: false,
      error: 'barcode is missing',
      rawBarcode,
      barcode: normalizedBarcode,
      poNumber: '',
      orderType: null,
      isReprint: false,
      reprintKind: null,
    };
  }

  const dashIndex = normalizedBarcode.lastIndexOf('-');
  let poNumber = normalizedBarcode;
  let orderType = null;

  if (dashIndex > 0 && dashIndex < normalizedBarcode.length - 1) {
    const suffix = normalizedBarcode
      .slice(dashIndex + 1)
      .trim()
      .toUpperCase();
    if (ORDER_TYPE_SUFFIXES.has(suffix)) {
      poNumber = normalizedBarcode.slice(0, dashIndex).trim();
      orderType = suffix;
    } else if (/^[A-Za-z0-9]{1,8}$/.test(suffix)) {
      return {
        ok: false,
        error: `unsupported barcode order type suffix: ${suffix}`,
        rawBarcode,
        barcode: normalizedBarcode,
        poNumber: normalizedBarcode.slice(0, dashIndex).trim(),
        orderType: suffix,
        isReprint: false,
        reprintKind: null,
      };
    }
  } else {
    const compactReprintMatch = normalizedBarcode.match(/^(.+\d)(RS|RC|R)$/i);
    if (compactReprintMatch) {
      poNumber = compactReprintMatch[1].trim();
      orderType = compactReprintMatch[2].toUpperCase();
    }
  }

  if (!poNumber) {
    return {
      ok: false,
      error: 'barcode order number is missing',
      rawBarcode,
      barcode: normalizedBarcode,
      poNumber,
      orderType,
      isReprint: false,
      reprintKind: null,
    };
  }

  const isReprint = Boolean(orderType && orderType.startsWith('R'));
  return {
    ok: true,
    rawBarcode,
    barcode: normalizedBarcode,
    poNumber,
    orderType,
    isReprint,
    reprintKind: reprintKindForOrderType(orderType),
  };
}

module.exports = {
  ORDER_TYPE_SUFFIXES,
  parseBarcode,
  reprintKindForOrderType,
  stripCode39Stars,
};
