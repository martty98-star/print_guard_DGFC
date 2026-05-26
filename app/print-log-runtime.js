/* PrintGuard - print log runtime composition (loaded before app.js) */
'use strict';

(function attachPrintGuardPrintLogRuntime(global) {
  const PrintGuardPrintLog = global.PrintGuardPrintLog;
  const PrintLogUI = global.PrintGuardPrintLogUI;

  if (!PrintGuardPrintLog) {
    throw new Error('Missing PrintGuardPrintLog');
  }
  if (!PrintLogUI) {
    throw new Error('Missing PrintGuardPrintLogUI');
  }

  function createPrintLogRuntime(deps) {
    const {
      getPrintLogTodayQueueBasisLabel: getPrintLogTodayQueueBasisLabelUI,
      printLogRangeLabel: printLogRangeLabelUI,
      printResultClass: printResultClassUI,
      printResultLabel: printResultLabelUI,
      renderPrintLogComparison: renderPrintLogComparisonUI,
      renderPrintLogSummary: renderPrintLogSummaryUI,
      renderPrintLogTodayQueue: renderPrintLogTodayQueueUI,
    } = PrintLogUI;

    return PrintGuardPrintLog.createPrintLog({
      ...deps,
      getPrintLogTodayQueueBasisLabelUI,
      printLogRangeLabelUI,
      printResultClassUI,
      printResultLabelUI,
      renderPrintLogComparisonUI,
      renderPrintLogSummaryUI,
      renderPrintLogTodayQueueUI,
    });
  }

  global.PrintGuardPrintLogRuntime = {
    createPrintLogRuntime,
  };
})(window);
