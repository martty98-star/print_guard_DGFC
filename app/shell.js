/* PrintGuard - shell-level DOM bindings (loaded before app.js) */
'use strict';

(function attachPrintGuardShell(global) {
  function createShell(deps) {
    const {
      applyPreset,
      closeColoradoRollModal,
      closeColoradoRollSheet,
      el,
      getInitialScreen,
      loadColoradoRollEvents,
      loadColoradoRollStates,
      navigate,
      openColoradoRollSheet,
      renderColoradoRollTracker,
      runSync,
      saveColoradoRollModal,
      setMode,
      state,
      updateOfflineBanner,
    } = deps;

    function bindModeToggle() {
      document.querySelectorAll('.mode-btn').forEach((button) => {
        button.addEventListener('click', () => setMode(button.dataset.mode));
      });
    }

    function bindBottomNavs() {
      const toggle = el('bottom-nav-toggle');
      const setNavOpen = (open) => {
        document.body.classList.toggle('nav-open', Boolean(open));
        if (toggle) {
          toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
          toggle.setAttribute(
            'aria-label',
            open ? 'Zavřít spodní navigaci' : 'Otevřít spodní navigaci',
          );
        }
      };

      toggle?.addEventListener('click', () => {
        setNavOpen(!document.body.classList.contains('nav-open'));
      });

      document
        .querySelectorAll('#stock-nav .nav-item, #colorado-nav .nav-item')
        .forEach((button) => {
          button.addEventListener('click', () => {
            navigate(button.dataset.screen);
            setNavOpen(false);
          });
        });

      global.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') setNavOpen(false);
      });
    }

    function bindHistoryNavigation() {
      global.addEventListener('popstate', () => {
        navigate(getInitialScreen(), { replace: true });
      });
    }

    function bindBackButtons() {
      document.querySelectorAll('.back-btn').forEach((button) => {
        button.addEventListener('click', () =>
          navigate(button.dataset.screen || 'stock-overview'),
        );
      });
    }

    function bindTopbarActions() {
      el('fab-co-entry')?.addEventListener('click', () => navigate('co-entry'));
      el('nav-settings')?.addEventListener('click', () => navigate('settings'));
      el('sync-btn')?.addEventListener('click', async () => {
        await runSync();
      });
    }

    function bindColoradoRollShell() {
      el('roll-modal-save')?.addEventListener('click', () =>
        saveColoradoRollModal(),
      );
      document.querySelectorAll('[data-roll-cancel]').forEach((button) => {
        button.addEventListener('click', closeColoradoRollModal);
      });
      el('roll-modal')?.addEventListener('click', (event) => {
        if (event.target === el('roll-modal')) closeColoradoRollModal();
      });

      el('roll-mobile-toggle')?.addEventListener('click', () =>
        openColoradoRollSheet(),
      );
      document
        .querySelectorAll('[data-roll-sheet-cancel]')
        .forEach((button) => {
          button.addEventListener('click', closeColoradoRollSheet);
        });
      el('roll-sheet')?.addEventListener('click', (event) => {
        if (event.target === el('roll-sheet')) closeColoradoRollSheet();
      });

      global.addEventListener('storage', (event) => {
        if (event.key !== 'pg_colorado_roll_state_v1') return;
        state.coloradoRolls = loadColoradoRollStates();
        state.coloradoRollEvents = loadColoradoRollEvents();
        renderColoradoRollTracker();
      });
    }

    function bindLanguageSelect() {
      const langSelect = el('lang-select');
      if (!langSelect) return;
      langSelect.value =
        (global.I18N && global.I18N.currentLang) ||
        (global.I18N && global.I18N.defaultLang) ||
        'cs';
      langSelect.addEventListener('change', (event) => {
        if (global.I18N && typeof global.I18N.setLang === 'function') {
          global.I18N.setLang(event.target.value);
        }
      });
    }

    function bindDatePresets() {
      document.querySelectorAll('.dr-preset').forEach((button) => {
        button.addEventListener('click', () =>
          applyPreset(button.dataset.range, button.dataset.target),
        );
      });
    }

    function bindConnectivityHandlers() {
      global.addEventListener('online', updateOfflineBanner);
      global.addEventListener('offline', updateOfflineBanner);
      updateOfflineBanner();
    }

    function bindShellControls() {
      bindModeToggle();
      bindBottomNavs();
      bindHistoryNavigation();
      bindBackButtons();
      bindTopbarActions();
      bindColoradoRollShell();
      bindLanguageSelect();
      bindDatePresets();
      bindConnectivityHandlers();
    }

    return {
      bindShellControls,
    };
  }

  global.PrintGuardShell = { createShell };
})(window);
