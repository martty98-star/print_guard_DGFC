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

  function generateReprintXml(order, printFile) {
    const orderName = order.processedOrderName || order.orderName || order.order_number || order.id || 'ORDER';
    const files = normalizePrintFiles(order, printFile);
    const printFileXml = files.map((file) => {
      const pageSize = file.pageSize || file.page_size || '';
      const printFilePath = file.printFilePath || file.print_file_path || '';
      return `    <PrintFile>
      <FileName>${escXml(printFilePath)}</FileName>
      <Copies>1</Copies>${pageSize ? `
      <Variables>
        <Variable>
          <Name>PageSize</Name>
          <Value>${escXml(pageSize)}</Value>
        </Variable>
      </Variables>` : ''}
    </PrintFile>`;
    }).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<PrintJob>
  <Name>${escXml(orderName)} - REPRINT</Name>
  <XmlFileName>${escXml(orderName)}_REPRINT.xml</XmlFileName>
  <Status>Opened</Status>
  <OrderDateTime>${escXml(new Date().toISOString())}</OrderDateTime>
  <PrintFiles>
${printFileXml}
  </PrintFiles>
  <PrinterName>${escXml(order.printerName || order.printer_name || '')}</PrinterName>
  <RunWorkflow>true</RunWorkflow>
  <WorkflowName>${escXml(order.workflowName || order.workflow_name || '')}</WorkflowName>
  <OrderType>R</OrderType>
</PrintJob>
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
    downloadXml,
    fileNameFromPath,
    generateReprintXml,
  };
})();
