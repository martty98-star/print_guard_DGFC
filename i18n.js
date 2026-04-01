(() => {
  const translations = {
    cs: {
      'nav.stock': 'Sklad',
      'nav.colorado': 'Colorado',
      'nav.overview': 'Přehled',
      'nav.movement': 'Pohyb',
      'nav.alerts': 'Upozornění',
      'nav.history': 'Historie',
      'nav.items': 'Položky',
      'nav.settings': 'Nastavení',
      'nav.consumption': 'Spotřeba',
      'nav.new-record': 'Nový záznam',
      'nav.print-log': 'Tiskový log',

      'header.stock-overview': 'Přehled skladu',
      'header.stock-movement': 'Pohyb skladu',
      'header.stock-alerts': 'Upozornění',
      'header.stock-items': 'Správa položek',
      'header.stock-detail': 'Detail položky',
      'header.stock-log': 'Historie pohybu',
      'header.co-dashboard': 'Spotřeba Colorado',
      'header.co-entry': 'Nový záznam',
      'header.co-history': 'Historie Colorado',
      'header.print-log': 'Tiskový log',
      'header.settings': 'Nastavení',

      'btn.add-movement': 'Nový pohyb',
      'btn.add-item': '+ Přidat položku',
      'btn.export-csv': 'Export CSV',
      'btn.save': 'Uložit',
      'btn.cancel': 'Zrušit',
      'btn.delete': 'Smazat',
      'btn.edit': 'Upravit',
      'btn.refresh': 'Obnovit',
      'btn.sync': 'Sync',

      'lbl.type': 'Typ pohybu',
      'lbl.item': 'Položka',
      'lbl.quantity': 'Množství',
      'lbl.note': 'Poznámka',
      'lbl.machine': 'Tiskárna',
      'lbl.ink-total': 'Inkoust celkem (L)',
      'lbl.media-total': 'Médium celkem (m²)',
      'lbl.timestamp': 'Datum a čas',
      'lbl.language': 'Jazyk',
      'settings.language': 'Jazyk / Language',
      'stock.search.placeholder': 'Hledat položku…',
      'stock.log.search': 'Hledat položku, typ…',
      'filter.all': 'Vše',
      'filter.crit': 'Kritické',
      'filter.warn': 'Varování',
      'filter.ok': 'OK',
      'loading.stock': 'Načítám…',
      'loading.print-log': 'Načítám tiskový log…',
      'date.from': 'Od',
      'date.to': 'Do',
      'date.clear': 'Zrušit filtr dat',
      'preset.7days': '7 dní',
      'preset.30days': '30 dní',
      'preset.90days': '90 dní',
      'preset.month': 'Tento měsíc',
      'preset.year': 'Tento rok',

      'mov.receipt': 'Příjem',
      'mov.issue': 'Výdej',
      'mov.stocktake': 'Inventura',
      'movement.type.label': 'Typ pohybu *',
      'movement.type.receipt': 'Příjem',
      'movement.type.receipt.hint': 'naskladnění',
      'movement.type.issue': 'Výdej',
      'movement.type.issue.hint': 'vyskladnění',
      'movement.type.stocktake': 'Inventura',
      'movement.type.stocktake.hint': 'nastav stav',
      'movement.item.label': 'Položka *',
      'movement.item.placeholder': 'Hledat číslo nebo název…',
      'movement.qty.label': 'Množství *',
      'movement.note.label': 'Poznámka',
      'movement.note.placeholder': 'Dodavatel, č. faktury, důvod výdeje…',
      'movement.preview.current': 'Aktuální stav na skladě',
      'movement.preview.after': 'Stav po operaci',
      'movement.preview.status': 'Status po operaci',
      'movement.save': 'Uložit pohyb',
      'common.optional': '(volitelné)',

      'status.ok': 'OK',
      'status.warn': 'Varování',
      'status.crit': 'Kritické',

      'colorado.info': 'Průměry jsou vypočítány z posledních N intervalů (nastavitelné). Čisticí / purge cykly způsobí vyšší L/m² pro daný interval — to je záměrné, auditní hodnota reálné spotřeby.',
      'colorado.entry.printer': 'Tiskárna *',
      'colorado.entry.ink.label': 'Inkoust celkem — lifetime čítač (L) *',
      'colorado.entry.ink.hint': 'Celoživotní hodnota z displeje tiskárny v litrech',
      'colorado.entry.media.label': 'Médium celkem — lifetime čítač (m²) *',
      'colorado.entry.media.hint': 'Celoživotní hodnota z displeje tiskárny v m²',
      'colorado.entry.timestamp.label': 'Datum a čas záznamu',
      'colorado.entry.timestamp.hint': 'Výchozí: aktuální čas. Lze upravit pro zpětné zadání.',
      'colorado.entry.note.label': 'Poznámka',
      'colorado.entry.note.placeholder': 'Např. po čisticím cyklu, po výměně cartridge…',
      'colorado.entry.preview.title': 'Náhled výpočtu (oproti předchozímu záznamu)',
      'colorado.entry.preview.ink': 'Spotřeba inkoustu',
      'colorado.entry.preview.media': 'Spotřeba média',
      'colorado.entry.preview.ratio': 'Spotřeba inkoustu na m²',
      'colorado.entry.preview.days': 'Počet dní od posledního záznamu',
      'colorado.entry.save': 'Uložit záznam Colorado',

      'print.stats.done': 'Hotové úlohy',
      'print.stats.aborted': 'Přerušené úlohy',
      'print.stats.deleted': 'Smazané úlohy',
      'print.stats.printed-area': 'Vytištěná plocha',
      'print.stats.media': 'Spotřeba média',
      'print.stats.duration': 'Celková doba',
      'print.stats.grouped': 'Seskupené úlohy',
      'print.stats.first-pass': 'Úspěch napoprvé',
      'print.stats.first-rate': 'Úspěšnost napoprvé',
      'print.stats.resolved': 'Vyřešené opakování',
      'print.stats.open': 'Otevřené / nevyřešené',
      'print.stats.attempts': 'Průměr pokusů / úloha',
      'print.stats.attempts-success': 'Průměr pokusů / úspěch',
      'print.status.default': 'Data ze serveru',
      'print.compare.title': 'Colorado A vs Colorado B',
      'print.compare.range': 'aktuální filtr',
      'print.waiting': 'Čekám na data',
      'print.filter.view': 'Zobrazení',
      'print.view.raw': 'Přehled aktivit',
      'print.view.grouped': 'Řešení problémů / SLA',
      'print.filter.printer': 'Tiskárna',
      'print.filter.result': 'Výsledek',
      'print.result.done': 'Hotovo',
      'print.result.deleted': 'Smazáno',
      'print.filter.lifecycle': 'Filtr průběhu',
      'print.lifecycle.all': 'Všechny skupiny průběhu',
      'print.lifecycle.open': 'Jen otevřené problémy',
      'print.lifecycle.resolved': 'Jen vyřešené opakováním',
      'print.lifecycle.multi': 'Jen úlohy s více pokusy',
      'print.lifecycle.first': 'Jen úspěšné napoprvé',
      'print.table.title': 'Poslední tiskové aktivity',
      'print.footnote': 'Posledních 50 řádků',

      'msg.offline': 'Offline — data uložena lokálně',
      'msg.no-items': 'Žádné položky',
      'msg.no-alerts': 'Žádná upozornění',
      'msg.save-success': 'Uloženo',
      'msg.delete-confirm': 'Smazat tuto položku?',

      'lang.cs': 'Čeština',
      'lang.en': 'English'
    },

    en: {
      'nav.stock': 'Stock',
      'nav.colorado': 'Colorado',
      'nav.overview': 'Overview',
      'nav.movement': 'Movement',
      'nav.alerts': 'Alerts',
      'nav.history': 'History',
      'nav.items': 'Items',
      'nav.settings': 'Settings',
      'nav.consumption': 'Consumption',
      'nav.new-record': 'New Record',
      'nav.print-log': 'Print Log',

      'header.stock-overview': 'Stock Overview',
      'header.stock-movement': 'Stock Movement',
      'header.stock-alerts': 'Alerts',
      'header.stock-items': 'Item Management',
      'header.stock-detail': 'Item Detail',
      'header.stock-log': 'Movement History',
      'header.co-dashboard': 'Colorado Consumption',
      'header.co-entry': 'New Record',
      'header.co-history': 'Colorado History',
      'header.print-log': 'Print Log',
      'header.settings': 'Settings',

      'btn.add-movement': 'New Movement',
      'btn.add-item': '+ Add Item',
      'btn.export-csv': 'Export CSV',
      'btn.save': 'Save',
      'btn.cancel': 'Cancel',
      'btn.delete': 'Delete',
      'btn.edit': 'Edit',
      'btn.refresh': 'Refresh',
      'btn.sync': 'Sync',

      'lbl.type': 'Movement Type',
      'lbl.item': 'Item',
      'lbl.quantity': 'Quantity',
      'lbl.note': 'Note',
      'lbl.machine': 'Printer',
      'lbl.ink-total': 'Ink Total (L)',
      'lbl.media-total': 'Media Total (m²)',
      'lbl.timestamp': 'Date & Time',
      'lbl.language': 'Language',
      'settings.language': 'Language / Jazyk',
      'stock.search.placeholder': 'Search item…',
      'stock.log.search': 'Search item, type…',
      'filter.all': 'All',
      'filter.crit': 'Critical',
      'filter.warn': 'Warning',
      'filter.ok': 'OK',
      'loading.stock': 'Loading…',
      'loading.print-log': 'Loading print log…',
      'date.from': 'From',
      'date.to': 'To',
      'date.clear': 'Clear date filter',
      'preset.7days': '7 days',
      'preset.30days': '30 days',
      'preset.90days': '90 days',
      'preset.month': 'This month',
      'preset.year': 'This year',

      'mov.receipt': 'Receipt',
      'mov.issue': 'Issue',
      'mov.stocktake': 'Stocktake',
      'movement.type.label': 'Movement type *',
      'movement.type.receipt': 'Receipt',
      'movement.type.receipt.hint': 'stock in',
      'movement.type.issue': 'Issue',
      'movement.type.issue.hint': 'stock out',
      'movement.type.stocktake': 'Stocktake',
      'movement.type.stocktake.hint': 'set level',
      'movement.item.label': 'Item *',
      'movement.item.placeholder': 'Search number or name…',
      'movement.qty.label': 'Quantity *',
      'movement.note.label': 'Note',
      'movement.note.placeholder': 'Supplier, invoice no., purpose…',
      'movement.preview.current': 'Current stock level',
      'movement.preview.after': 'Level after operation',
      'movement.preview.status': 'Status after operation',
      'movement.save': 'Save movement',
      'common.optional': '(optional)',

      'status.ok': 'OK',
      'status.warn': 'Warning',
      'status.crit': 'Critical',

      'colorado.info': 'Averages are computed from the last N intervals (configurable). Cleaning / purge cycles raise L/m² for the affected interval — that is intentional to preserve the true audited consumption.',
      'colorado.entry.printer': 'Printer *',
      'colorado.entry.ink.label': 'Ink total — lifetime counter (L) *',
      'colorado.entry.ink.hint': 'Value from the printer display in liters',
      'colorado.entry.media.label': 'Media total — lifetime counter (m²) *',
      'colorado.entry.media.hint': 'Value from the printer display in square meters',
      'colorado.entry.timestamp.label': 'Record date & time',
      'colorado.entry.timestamp.hint': 'Default: current time. Adjust for backdated entries.',
      'colorado.entry.note.label': 'Note',
      'colorado.entry.note.placeholder': 'e.g. after cleaning cycle, after cartridge swap…',
      'colorado.entry.preview.title': 'Computation preview (vs previous record)',
      'colorado.entry.preview.ink': 'Ink consumption',
      'colorado.entry.preview.media': 'Media consumption',
      'colorado.entry.preview.ratio': 'Ink consumption per m²',
      'colorado.entry.preview.days': 'Days since last record',
      'colorado.entry.save': 'Save Colorado record',

      'print.stats.done': 'Completed jobs',
      'print.stats.aborted': 'Aborted jobs',
      'print.stats.deleted': 'Deleted jobs',
      'print.stats.printed-area': 'Printed area',
      'print.stats.media': 'Media usage',
      'print.stats.duration': 'Total duration',
      'print.stats.grouped': 'Grouped jobs',
      'print.stats.first-pass': 'First-pass success',
      'print.stats.first-rate': 'First-pass rate',
      'print.stats.resolved': 'Resolved after retry',
      'print.stats.open': 'Open / unresolved',
      'print.stats.attempts': 'Avg attempts / job',
      'print.stats.attempts-success': 'Avg attempts / success',
      'print.status.default': 'Server data',
      'print.compare.title': 'Colorado A vs Colorado B',
      'print.compare.range': 'current filter',
      'print.waiting': 'Waiting for data',
      'print.filter.view': 'Display',
      'print.view.raw': 'Activity overview',
      'print.view.grouped': 'Issue resolution / SLA',
      'print.filter.printer': 'Printer',
      'print.filter.result': 'Result',
      'print.result.done': 'Done',
      'print.result.deleted': 'Deleted',
      'print.filter.lifecycle': 'Lifecycle filter',
      'print.lifecycle.all': 'All lifecycles',
      'print.lifecycle.open': 'Only open issues',
      'print.lifecycle.resolved': 'Only resolved after retry',
      'print.lifecycle.multi': 'Only multi-attempt jobs',
      'print.lifecycle.first': 'Only first-pass success',
      'print.table.title': 'Latest print activities',
      'print.footnote': 'Last 50 rows',

      'msg.offline': 'Offline — data stored locally',
      'msg.no-items': 'No items',
      'msg.no-alerts': 'No alerts',
      'msg.save-success': 'Saved',
      'msg.delete-confirm': 'Delete this item?',

      'lang.cs': 'Czech',
      'lang.en': 'English'
    }
  };

  const I18N = {
    defaultLang: 'cs',
    currentLang: 'cs',
    translations,

    t(key) {
      const dict = this.translations[this.currentLang] || {};
      if (dict[key]) return dict[key];
      const fallback = this.translations[this.defaultLang] || {};
      return fallback[key] || key;
    },

    setLang(lang) {
      if (!this.translations[lang]) lang = this.defaultLang;
      this.currentLang = lang;

      try {
        localStorage.setItem('pg_lang', lang);
      } catch (_) {
        /* ignore storage errors */
      }

      document.documentElement.lang = lang;
      this.applyTranslations();
    },

    applyTranslations() {
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        if (!key) return;
        const txt = this.t(key);
        if (el.textContent !== txt) el.textContent = txt;
      });

      document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.dataset.i18nPlaceholder;
        if (!key) return;
        const txt = this.t(key);
        if (el.placeholder !== txt) el.placeholder = txt;
      });

      document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.dataset.i18nTitle;
        if (!key) return;
        const txt = this.t(key);
        if (el.title !== txt) el.title = txt;
      });

      const select = document.getElementById('lang-select');
      if (select && select.value !== this.currentLang) {
        select.value = this.currentLang;
      }

      window.dispatchEvent(new CustomEvent('i18n:changed', {
        detail: { lang: this.currentLang }
      }));
    },

    init() {
      let saved = this.defaultLang;
      try {
        saved = localStorage.getItem('pg_lang') || this.defaultLang;
      } catch (_) {
        saved = this.defaultLang;
      }
      this.setLang(saved);
    }
  };

  window.I18N = I18N;
})();
