/* PrintGuard - Colorado runtime composition (loaded before app.js) */
'use strict';

(function attachPrintGuardColoradoRuntime(global) {
  const PrintGuardColoradoController = global.PrintGuardColoradoController;

  if (!PrintGuardColoradoController) {
    throw new Error('Missing PrintGuardColoradoController');
  }

  function createColoradoRuntime(deps) {
    return PrintGuardColoradoController.createColoradoController(deps || {});
  }

  global.PrintGuardColoradoRuntime = {
    createColoradoRuntime,
  };
})(window);
