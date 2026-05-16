// ============================================================
// LipoLand — Costs breakdown module
// ============================================================
// Таблиця розкладу собівартості по всіх іграх (інтегрована в Аналітику).
// dismissAlert — закриття "low-stock" сповіщень на дашборді.

(function(){
  'use strict';

  // ==================== COSTS ====================
  function renderCosts() {
    var db = getDB();
    var tb = document.getElementById('costs-table');
    var detailHTML = '';
    tb.innerHTML = db.products.filter(function(p){return p.active!==false}).map(function(p) {
      var cost = calcCost(p, db.materials, db);
      var margin = p.sellPrice - cost.total;
      var marginPct = p.sellPrice>0 ? (margin/p.sellPrice*100) : 0;
      var rateLabel = cost.rateType==='percent' ? '('+fmt(cost.rateValue)+'%)' : '(фікс.)';
      // Detail card
      var matDetails = (p.recipe||[]).map(function(r) {
        var mat = db.materials.find(function(m){return m.id===r.materialId});
        if(!mat) return '';
        return '<tr><td style="padding-left:30px;">📦 '+esc(mat.name)+'</td><td>'+fmt(r.qty)+' '+esc(mat.unit)+'</td><td>'+fmt(mat.price)+' грн/'+esc(mat.unit)+'</td><td>'+fmt(r.qty*mat.price)+' грн</td></tr>';
      }).join('');
      var hasDetails = matDetails || cost.print > 0 || cost.packaging > 0;
      if(hasDetails || matDetails) {
        detailHTML += '<div class="table-wrap" style="margin-bottom:12px;">'+
          '<table><thead><tr><th colspan="4" style="font-size:14px;">'+(p.sku?'<code>'+esc(p.sku)+'</code> — ':'')+esc(p.name)+'</th></tr><tr><th>Складова</th><th>Деталі</th><th>Ціна</th><th>Вартість</th></tr></thead>'+
          '<tbody>'+matDetails;
        if (matDetails) {
          detailHTML += '<tr style="font-weight:600;background:#EDE7F6;"><td>📦 Матеріали разом</td><td></td><td></td><td>'+fmt(cost.materials)+' грн</td></tr>';
        }
        if (cost.print > 0) {
          var ps = db.printerSettings||{};
          var printParts = [];
          if (p.pages > 0) printParts.push(p.pages+' А4');
          if (p.pagesA5 > 0) printParts.push(p.pagesA5+' А5');
          detailHTML += '<tr><td style="padding-left:30px;">🖨 Друк</td><td>'+printParts.join(' + ')+'</td><td>'+fmt(ps.costPerPageA4||0)+' грн/А4</td><td>'+fmt(cost.print)+' грн</td></tr>';
        }
        if (cost.packaging > 0) {
          detailHTML += '<tr><td style="padding-left:30px;">📎 Пакування</td><td></td><td></td><td>'+fmt(cost.packaging)+' грн</td></tr>';
        }
        if ((p.templateCost||0) > 0 && (p.templateQty||0) > 0) {
          var _cov = p.templateCovered || 0;
          var _qty = p.templateQty || 0;
          var _remaining = Math.max(0, _qty - _cov);
          var _status = _remaining === 0
            ? '<span style="color:var(--success);">✅ окуплено ('+_cov+'/'+_qty+')</span>'
            : 'покрито '+_cov+'/'+_qty+' шт · ще '+_remaining+' шт';
          detailHTML += '<tr><td style="padding-left:30px;">💎 Шаблон</td><td>'+fmt(p.templateCost||0)+' грн ÷ '+_qty+' шт · '+_status+'</td><td></td><td>'+fmt(cost.template)+' грн</td></tr>';
        }
        detailHTML += '<tr style="background:#EDE7F6;"><td>👩‍🔧 Робота майстра '+rateLabel+'</td><td></td><td></td><td>'+fmt(cost.work)+' грн</td></tr>';
        detailHTML += '<tr style="font-weight:700;background:#D1C4E9;"><td>СОБІВАРТІСТЬ</td><td></td><td></td><td>'+fmt(cost.total)+' грн</td></tr>';
        detailHTML += '<tr><td>Ціна продажу</td><td></td><td></td><td>'+fmt(p.sellPrice)+' грн</td></tr>';
        detailHTML += '<tr style="font-weight:600;"><td>Маржа</td><td></td><td></td><td class="'+(margin>0?'text-success':'text-danger')+'">'+fmt(margin)+' грн ('+fmt(marginPct)+'%)</td></tr>';
        detailHTML += '</tbody></table></div>';
      }
      return '<tr>'+
        '<td data-label="Артикул"><code>'+esc(p.sku||'—')+'</code></td>'+
        '<td data-label="Гра"><strong>'+esc(p.name)+'</strong></td>'+
        '<td data-label="Матеріали">'+fmt(cost.materials)+' грн</td>'+
        '<td data-label="Друк">'+(cost.print>0?fmt(cost.print):'—')+'</td>'+
        '<td data-label="Пакування">'+(cost.packaging>0?fmt(cost.packaging):'—')+'</td>'+
        '<td data-label="Шаблон">'+(cost.template>0?fmt(cost.template):'—')+'</td>'+
        '<td data-label="Робота">'+fmt(cost.work)+' <span class="text-muted" style="font-size:10px;">'+rateLabel+'</span></td>'+
        '<td data-label="Собівартість"><strong>'+fmt(cost.total)+'</strong></td><td data-label="Ціна продажу">'+fmt(p.sellPrice)+'</td>'+
        '<td data-label="Маржа, грн" class="'+(margin>0?'text-success':'text-danger')+'">'+fmt(margin)+'</td>'+
        '<td data-label="Маржа, %" class="'+(marginPct>30?'text-success':marginPct>15?'text-warning':'text-danger')+'">'+fmt(marginPct)+'%</td>'+
      '</tr>';
    }).join('') || '<tr><td colspan="11" class="text-muted" style="text-align:center;padding:40px;">Додайте ігри зі складом виробу</td></tr>';
    document.getElementById('costs-detail').innerHTML = detailHTML;
  }
  
  function dismissAlert(key) {
    var dismissed = JSON.parse(localStorage.getItem('lipo_dismissed_alerts') || '{}');
    dismissed[key] = new Date().toISOString().slice(0,10);
    localStorage.setItem('lipo_dismissed_alerts', JSON.stringify(dismissed));
    var el = document.getElementById('alert-'+key);
    if (el) { el.style.transition='opacity .3s,max-height .3s'; el.style.opacity='0'; el.style.maxHeight='0'; el.style.overflow='hidden'; el.style.marginBottom='0'; el.style.padding='0 16px';
      setTimeout(function(){ el.remove(); }, 300);
    }
  }
  

  window.renderCosts = renderCosts;
  window.dismissAlert = dismissAlert;
})();
