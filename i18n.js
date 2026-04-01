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

      'mov.receipt': 'Příjem',
      'mov.issue': 'Výdej',
      'mov.stocktake': 'Inventura',

      'status.ok': 'OK',
      'status.warn': 'Varování',
      'status.crit': 'Kritické',

      'msg.offline': 'Offline – data uložena lokálně',
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

      'mov.receipt': 'Receipt',
      'mov.issue': 'Issue',
      'mov.stocktake': 'Stocktake',

      'status.ok': 'OK',
      'status.warn': 'Warning',
      'status.crit': 'Critical',

      'msg.offline': 'Offline – data stored locally',
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