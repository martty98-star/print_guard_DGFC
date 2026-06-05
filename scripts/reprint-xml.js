'use strict';

(() => {
  function escXml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function fileNameFromPath(value) {
    const raw = String(value || '');
    return raw.split(/[\\/]/).filter(Boolean).pop() || raw;
  }

  function normalizePrintFiles(order, printFile) {
    if (printFile && (printFile.printFilePath || printFile.print_file_path)) return [printFile];
    return Array.isArray(order && order.printFiles) ? order.printFiles : [];
  }

  function cleanValue(value) {
    const cleaned = String(value == null ? '' : value).trim();
    return cleaned || '';
  }

  function normalizeOrderIdToken(value) {
    const raw = cleanValue(value);
    if (!raw) return '';
    return raw.replace(/_REPRINT$/i, '');
  }

  function normalizePoNumberToken(value) {
    const raw = cleanValue(value);
    if (!raw) return '';
    const strippedSuffix = raw.replace(/_REPRINT$/i, '');
    const psMatch = strippedSuffix.match(/^PS(\d+)$/i);
    if (psMatch) return psMatch[1];
    return strippedSuffix;
  }

  function normalizeScanBarcodeToken(value) {
    return cleanValue(value)
      .replace(/_REPRINT$/i, '')
      .replace(/[-_ ]*(RS|RC|R)$/i, '');
  }

  function pickOriginalOrderId(order) {
    const candidates = [
      order && order.originalOrderId,
      order && order.OrderId,
      order && order.orderId,
      order && order.order_id,
      order && order.apiOrderId,
      order && order.api_order_id,
      order && order.processedOrderName,
      order && order.orderName,
      order && order.order_number,
      order && order.externalOrderId,
      order && order.external_order_id,
      order && order.customerOrderId,
      order && order.customer_order_id,
      order && order.id,
    ];
    for (const candidate of candidates) {
      const value = normalizeOrderIdToken(candidate);
      if (value) return value;
    }
    return 'ORDER';
  }

  function normalizePoNumber(order) {
    const raw = normalizePoNumberToken(
      order && (
        order.PoNumber ||
        order.poNumber ||
        order.po_number ||
        order.originalPoNumber ||
        order.original_po_number ||
        order.customerOrderId ||
        order.customer_order_id ||
        order.externalOrderId ||
        order.external_order_id ||
        order.orderName ||
        order.order_number
      )
    ) || pickOriginalOrderId(order);
    return raw;
  }

  function assertCleanReprintTokens(order) {
    const poNumber = normalizePoNumber(order);
    if (/_REPRINT$/i.test(poNumber)) {
      throw new Error(`Invalid reprint PoNumber: ${poNumber}`);
    }
    return poNumber;
  }

  function normalizeOrderType(value) {
    const normalized = String(value || '').trim().toUpperCase();
    if (normalized === 'S') return 'S';
    if (normalized === 'C') return 'C';
    if (normalized === 'R') return 'R';
    if (normalized === 'RS') return 'RS';
    if (normalized === 'RC') return 'RC';
    return '';
  }

  function getReprintOrderType(order) {
    const parentType = normalizeOrderType(order && (
      order.orderType ||
      order.order_type ||
      order.OrderType
    ));
    if (parentType === 'S') return 'RS';
    if (parentType === 'C') return 'RC';
    if (parentType === 'RS' || parentType === 'RC') return parentType;
    return 'R';
  }

  function getReprintScanBarcode(order) {
    const orderType = getReprintOrderType(order);
    const baseCandidates = [
      order && order.scanBarcode,
      order && order.ScanBarcode,
      order && order.originalPoNumber,
      order && order.original_po_number,
      order && order.PoNumber,
      order && order.poNumber,
      order && order.po_number,
      order && order.processedOrderName,
      order && order.orderName,
      order && order.order_number,
      order && order.externalOrderId,
      order && order.external_order_id,
      order && order.customerOrderId,
      order && order.customer_order_id,
    ];
    for (const candidate of baseCandidates) {
      const base = normalizeScanBarcodeToken(candidate);
      if (base) return `${base}${orderType}`;
    }
    return `${assertCleanReprintTokens(order)}${orderType}`;
  }

  function xmlDocument(pageSize, copies, printFilePath) {
    const localFileName = fileNameFromPath(printFilePath);
    return `  <XmlPrintDocument LocalFileName="${escXml(localFileName)}" FullPath="${escXml(printFilePath)}">
    <XmlPrintPage PageSize="${escXml(pageSize || '')}" Copies="${escXml(String(copies || 1))}"/>
  </XmlPrintDocument>`;
  }

  function generateReprintXml(order, printFile) {
    const orderId = pickOriginalOrderId(order);
    const poNumber = assertCleanReprintTokens(order);
    const orderType = getReprintOrderType(order);
    const scanBarcode = getReprintScanBarcode(order);
    const files = normalizePrintFiles(order, printFile);
    const printFileXml = files.map((file) => {
      const pageSize = file.pageSize || file.page_size || '';
      const printFilePath = file.printFilePath || file.print_file_path || '';
      const copies = file.copies == null || file.copies === '' ? 1 : file.copies;
      return xmlDocument(pageSize, copies, printFilePath);
    }).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<XmlPrintJob OrderId="${escXml(orderId)}" PoNumber="${escXml(poNumber)}" OrderDate="${escXml(new Date().toISOString())}" OrderType="${escXml(orderType)}" ScanBarcode="${escXml(scanBarcode)}">
${printFileXml}
</XmlPrintJob>
`;
  }

  function downloadXml(xml, orderName) {
    const filename = `${String(orderName || 'ORDER').replace(/[^\w.-]+/g, '_')}_REPRINT.xml`;
    const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return filename;
  }

  window.PrintGuardReprintXml = {
    assertCleanReprintTokens,
    downloadXml,
    fileNameFromPath,
    generateReprintXml,
    getReprintScanBarcode,
    getReprintOrderType,
    pickOriginalOrderId,
  };
})();
