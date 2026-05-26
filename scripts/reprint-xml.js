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

  function normalizeOrderToken(value) {
    const raw = cleanValue(value);
    if (!raw) return '';
    const strippedSuffix = raw.replace(/_REPRINT$/i, '');
    const psMatch = strippedSuffix.match(/^PS(\d+)$/i);
    if (psMatch) return psMatch[1];
    return strippedSuffix;
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
      const value = normalizeOrderToken(candidate);
      if (value) return value;
    }
    return 'ORDER';
  }

  function normalizePoNumber(order) {
    const raw = normalizeOrderToken(
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

  function xmlDocument(pageSize, copies, printFilePath) {
    const localFileName = fileNameFromPath(printFilePath);
    return `  <XmlPrintDocument LocalFileName="${escXml(localFileName)}" FullPath="${escXml(printFilePath)}">
    <XmlPrintPage PageSize="${escXml(pageSize || '')}" Copies="${escXml(String(copies || 1))}"/>
  </XmlPrintDocument>`;
  }

  function generateReprintXml(order, printFile) {
    const orderId = pickOriginalOrderId(order);
    const poNumber = assertCleanReprintTokens(order);
    const files = normalizePrintFiles(order, printFile);
    const printFileXml = files.map((file) => {
      const pageSize = file.pageSize || file.page_size || '';
      const printFilePath = file.printFilePath || file.print_file_path || '';
      const copies = file.copies == null || file.copies === '' ? 1 : file.copies;
      return xmlDocument(pageSize, copies, printFilePath);
    }).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<XmlPrintJob OrderId="${escXml(orderId)}" PoNumber="${escXml(poNumber)}" OrderDate="${escXml(new Date().toISOString())}" OrderType="R">
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
    pickOriginalOrderId,
  };
})();
