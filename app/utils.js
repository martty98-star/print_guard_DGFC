/* PrintGuard — shared pure utility facade (loaded before app.js) */
'use strict';

(function attachPrintGuardUtils(global) {
  const CoreUtils = global.PrintGuardCoreUtils;
  const DomUtils = global.PrintGuardDomUtils;
  const ExportUtils = global.PrintGuardExportUtils;

  if (!CoreUtils) throw new Error('Missing PrintGuardCoreUtils');
  if (!DomUtils) throw new Error('Missing PrintGuardDomUtils');
  if (!ExportUtils) throw new Error('Missing PrintGuardExportUtils');

  const { ds, esc, fmtDays, fmtDT, fmtN, toISOfromDT, toLocalDT } = CoreUtils;
  const { el, elSet } = DomUtils;
  const { csvEsc, csvRow, dlBlob, fmtFileDT } = ExportUtils;

  global.PrintGuardUtils = {
    el,
    elSet,
    esc,
    fmtN,
    fmtDays,
    fmtDT,
    toLocalDT,
    toISOfromDT,
    ds,
    csvEsc,
    csvRow,
    fmtFileDT,
    dlBlob,
  };
})(window);
