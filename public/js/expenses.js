// ============================================================
// LipoLand — Expenses (OpEx) module
// ============================================================
// Витрати + шаблони витрат + розрахунок податків ФОП (1/2/3 групи).
// Авто-додавання категорії «📦 Закупка матеріалів» якщо нема (міграція).

(function(){
  'use strict';

  // ==================== EXPENSES (OpEx) ====================
  function populateExpenseCatSelects() {
    var db = getDB();
    // Міграція: якщо ключових системних категорій нема — додаємо.
    // Старі акаунти можуть мати неповний список, бо expenseCategories
    // зберігається в БД користувача а не в схемі.
    if (!db.expenseCategories) db.expenseCategories = [];
    var systemCats = ['📦 Закупка матеріалів'];
    var changed = false;
    systemCats.forEach(function(sc){
      if (db.expenseCategories.indexOf(sc) === -1) {
        // Додаємо першою — закупка матеріалів зазвичай основна стаття витрат
        db.expenseCategories.unshift(sc);
        changed = true;
      }
    });
    if (changed) saveDB(db);
    var cats = db.expenseCategories || [];
    ['exp-cat','exp-tpl-cat','exp-filter-cat'].forEach(function(id) {
      var sel = document.getElementById(id);
      if (!sel) return;
      var cur = sel.value;
      var prefix = (id === 'exp-filter-cat') ? '<option value="">Всі категорії</option>' : '';
      sel.innerHTML = prefix + cats.map(function(c){ return '<option value="'+esc(c)+'">'+esc(c)+'</option>'; }).join('');
      sel.value = cur;
    });
  }
  
  function openExpenseModal(id, prefillTemplateId) {
    var db = getDB();
    populateExpenseCatSelects();
    document.getElementById('expense-modal-title').textContent = id ? 'Редагувати витрату' : 'Додати витрату';
    if (id) {
      var e = (db.expenses||[]).find(function(x){ return x.id===id; });
      if (!e) return;
      document.getElementById('exp-id').value = id;
      document.getElementById('exp-date').value = e.date || new Date().toISOString().slice(0,10);
      document.getElementById('exp-cat').value = e.category || '';
      document.getElementById('exp-amount').value = e.amount || 0;
      document.getElementById('exp-note').value = e.note || '';
    } else {
      document.getElementById('exp-id').value = '';
      document.getElementById('exp-date').value = new Date().toISOString().slice(0,10);
      document.getElementById('exp-amount').value = '';
      document.getElementById('exp-note').value = '';
      if (prefillTemplateId) {
        var tpl = (db.expenseTemplates||[]).find(function(x){ return x.id===prefillTemplateId; });
        if (tpl) {
          document.getElementById('exp-cat').value = tpl.category || '';
          document.getElementById('exp-amount').value = tpl.defaultAmount || '';
          document.getElementById('exp-note').value = tpl.name || '';
        }
      } else {
        document.getElementById('exp-cat').selectedIndex = 0;
      }
    }
    openModal('expense');
  }
  
  function saveExpense() {
    var id = v('exp-id');
    var date = v('exp-date');
    var category = v('exp-cat');
    var amount = n('exp-amount');
    var note = v('exp-note');
    if (!date) return alert('Вкажіть дату');
    if (amount <= 0) return alert('Сума має бути більше 0');
    if (!category) return alert('Оберіть категорію');
    var db = getDB();
    if (!db.expenses) db.expenses = [];
    if (id) {
      var e = db.expenses.find(function(x){ return x.id===id; });
      if (e) { e.date = date; e.category = category; e.amount = amount; e.note = note; }
    } else {
      db.expenses.push({ id:uid(), date:date, category:category, amount:amount, note:note });
    }
    saveDB(db);
    closeModal('expense');
    renderExpenses();
  }
  
  function deleteExpense(id) {
    if (!confirm('Видалити цю витрату?')) return;
    var db = getDB();
    db.expenses = (db.expenses||[]).filter(function(x){ return x.id!==id; });
    saveDB(db);
    renderExpenses();
  }
  
  function openExpenseTemplateModal(id) {
    var db = getDB();
    populateExpenseCatSelects();
    var delBtn = document.getElementById('exp-tpl-del-btn');
    document.getElementById('exp-tpl-modal-title').textContent = id ? 'Редагувати шаблон' : 'Новий шаблон витрати';
    if (id) {
      var t = (db.expenseTemplates||[]).find(function(x){ return x.id===id; });
      if (!t) return;
      document.getElementById('exp-tpl-id').value = id;
      document.getElementById('exp-tpl-name').value = t.name || '';
      document.getElementById('exp-tpl-cat').value = t.category || '';
      document.getElementById('exp-tpl-amount').value = t.defaultAmount || 0;
      delBtn.style.display = 'inline-block';
    } else {
      document.getElementById('exp-tpl-id').value = '';
      document.getElementById('exp-tpl-name').value = '';
      document.getElementById('exp-tpl-amount').value = '';
      document.getElementById('exp-tpl-cat').selectedIndex = 0;
      delBtn.style.display = 'none';
    }
    openModal('expense-template');
  }
  
  function saveExpenseTemplate() {
    var id = v('exp-tpl-id');
    var name = v('exp-tpl-name');
    var cat = v('exp-tpl-cat');
    var amount = n('exp-tpl-amount');
    if (!name) return alert('Введіть назву');
    if (!cat) return alert('Оберіть категорію');
    var db = getDB();
    if (!db.expenseTemplates) db.expenseTemplates = [];
    if (id) {
      var t = db.expenseTemplates.find(function(x){ return x.id===id; });
      if (t) { t.name = name; t.category = cat; t.defaultAmount = amount; }
    } else {
      db.expenseTemplates.push({ id:uid(), name:name, category:cat, defaultAmount:amount });
    }
    saveDB(db);
    closeModal('expense-template');
    renderExpenses();
  }
  
  function deleteExpenseTemplate() {
    var id = v('exp-tpl-id');
    if (!id) return;
    if (!confirm('Видалити шаблон?')) return;
    var db = getDB();
    db.expenseTemplates = (db.expenseTemplates||[]).filter(function(x){ return x.id!==id; });
    saveDB(db);
    closeModal('expense-template');
    renderExpenses();
  }
  
  function quickAddFromTemplate(tplId) { openExpenseModal(null, tplId); }
  
  // Compute taxes for a given month (YYYY-MM) and revenue in that month.
  // Returns { amount, source: 'override'|'auto'|'none', label: 'ФОП 2 / 5% / …' }
  function computeTaxForMonth(db, month, revenue) {
    var ts = db.taxSettings || {};
    var overrides = ts.monthOverrides || {};
    if (overrides[month] !== undefined && overrides[month] !== null && overrides[month] !== '') {
      return { amount: parseFloat(overrides[month])||0, source:'override', label:'вручну' };
    }
    if (ts.fopGroup === 'group2') {
      return { amount: parseFloat(ts.fopGroup2Amount)||0, source:'auto', label:'ФОП 2 гр.' };
    }
    if (ts.fopGroup === 'group3') {
      var r3 = parseFloat(ts.fopGroup3Rate)||0;
      var mil = parseFloat(ts.militaryRate)||0;
      var amt = revenue * (r3 + mil) / 100;
      return { amount: Math.round(amt*100)/100, source:'auto', label:'ФОП 3 гр. '+r3+'%+ВЗ '+mil+'%' };
    }
    return { amount: 0, source:'none', label:'податки не налаштовані' };
  }
  
  function renderExpenses() {
    var db = getDB();
    populateExpenseCatSelects();
    var expenses = (db.expenses||[]).slice();
    var templates = db.expenseTemplates || [];
  
    var filterMonth = v('exp-filter-month');
    var filterCat = v('exp-filter-cat');
    var filtered = expenses.filter(function(e) {
      if (filterMonth && (e.date||'').slice(0,7) !== filterMonth) return false;
      if (filterCat && e.category !== filterCat) return false;
      return true;
    });
  
    // Summary: this month totals
    var thisMonth = new Date().toISOString().slice(0,7);
    var thisMonthTotal = expenses.filter(function(e){return (e.date||'').slice(0,7)===thisMonth}).reduce(function(s,e){return s+(e.amount||0)},0);
    var lastMonthDate = new Date(); lastMonthDate.setMonth(lastMonthDate.getMonth()-1);
    var lastMonth = lastMonthDate.toISOString().slice(0,7);
    var lastMonthTotal = expenses.filter(function(e){return (e.date||'').slice(0,7)===lastMonth}).reduce(function(s,e){return s+(e.amount||0)},0);
    var allTimeTotal = expenses.reduce(function(s,e){return s+(e.amount||0)},0);
  
    // By category this month
    var byCatThisMonth = {};
    expenses.filter(function(e){return (e.date||'').slice(0,7)===thisMonth}).forEach(function(e) {
      byCatThisMonth[e.category] = (byCatThisMonth[e.category]||0) + (e.amount||0);
    });
    var topCatEntry = Object.keys(byCatThisMonth).sort(function(a,b){ return byCatThisMonth[b]-byCatThisMonth[a]; })[0];
    var topCatStr = topCatEntry ? topCatEntry+' — '+fmt(byCatThisMonth[topCatEntry])+' грн' : '—';
  
    document.getElementById('expenses-summary').innerHTML =
      '<div class="card"><div class="card-label">Цього місяця</div><div class="card-value">'+fmt(thisMonthTotal)+'</div><div class="card-sub">грн</div></div>'+
      '<div class="card"><div class="card-label">Минулого місяця</div><div class="card-value">'+fmt(lastMonthTotal)+'</div><div class="card-sub">грн</div></div>'+
      '<div class="card"><div class="card-label">Найбільша категорія цього міс.</div><div class="card-value" style="font-size:16px;">'+esc(topCatStr)+'</div></div>'+
      '<div class="card"><div class="card-label">Всього за весь час</div><div class="card-value">'+fmt(allTimeTotal)+'</div><div class="card-sub">грн</div></div>';
  
    // Templates (quick-add chips)
    document.getElementById('expense-templates').innerHTML = templates.length
      ? templates.map(function(t) {
          return '<div style="background:linear-gradient(135deg,#F3E5F5,#E1BEE7);padding:10px 14px;border-radius:10px;display:flex;align-items:center;gap:10px;border:1px solid #CE93D8;">'+
            '<button class="btn btn-primary btn-sm" onclick="quickAddFromTemplate(\''+t.id+'\')" title="Додати цю витрату">+</button>'+
            '<div>'+
              '<div style="font-weight:600;font-size:13px;">'+esc(t.name)+'</div>'+
              '<div style="font-size:11px;color:var(--text-light);">'+esc(t.category||'')+' · орієнт. '+fmt(t.defaultAmount||0)+' грн</div>'+
            '</div>'+
            '<button class="btn btn-outline btn-sm" onclick="openExpenseTemplateModal(\''+t.id+'\')" title="Редагувати" style="padding:4px 8px;">✏️</button>'+
          '</div>';
        }).join('')
      : '<div style="font-size:12px;color:var(--text-light);padding:12px;background:var(--bg);border-radius:8px;">Поки що немає шаблонів. Створи перший: наприклад «Оренда офісу».</div>';
  
    // Table
    var rows = filtered.sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); }).map(function(e) {
      return '<tr>'+
        '<td data-label="Дата">'+esc(e.date||'')+'</td>'+
        '<td data-label="Категорія">'+esc(e.category||'')+'</td>'+
        '<td data-label="Сума"><strong>'+fmt(e.amount||0)+' грн</strong></td>'+
        '<td data-label="Опис">'+esc(e.note||'')+'</td>'+
        '<td data-label="Дії" style="white-space:nowrap;">'+
          '<button class="btn btn-outline btn-sm" onclick="openExpenseModal(\''+e.id+'\')" title="Редагувати">✏️</button> '+
          '<button class="btn btn-danger btn-sm" onclick="deleteExpense(\''+e.id+'\')" title="Видалити">🗑</button>'+
        '</td>'+
      '</tr>';
    }).join('');
    document.getElementById('expenses-table').innerHTML = rows || '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:30px;">Витрат ще не додано. Натисни «+ Додати витрату» або скористайся шаблоном-підказкою.</td></tr>';
  }

  window.populateExpenseCatSelects = populateExpenseCatSelects;
  window.openExpenseModal = openExpenseModal;
  window.saveExpense = saveExpense;
  window.deleteExpense = deleteExpense;
  window.openExpenseTemplateModal = openExpenseTemplateModal;
  window.saveExpenseTemplate = saveExpenseTemplate;
  window.deleteExpenseTemplate = deleteExpenseTemplate;
  window.quickAddFromTemplate = quickAddFromTemplate;
  window.computeTaxForMonth = computeTaxForMonth;
  window.renderExpenses = renderExpenses;
})();
