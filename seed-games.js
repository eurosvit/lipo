// ============================================================
// LIPOLAND — SEED SCRIPT: 10 ігор + потрібні матеріали
// ============================================================
// Як запустити:
// 1. Відкрий https://lipoland.top/app у браузері, залогінься
// 2. Відкрий DevTools (F12 або Cmd+Opt+I → вкладка Console)
// 3. Вставити ВЕСЬ цей файл у консоль, натиснути Enter
// 4. Чекай повідомлення "✅ Готово!" — перезавантаж сторінку
// ============================================================

(async () => {
  const log = (...a) => console.log('%c[seed]', 'color:#9b59b6;font-weight:bold', ...a);
  const warn = (...a) => console.warn('%c[seed]', 'color:#e67e22;font-weight:bold', ...a);

  // --- 1. Отримати поточні дані
  log('Завантажую дані з сервера...');
  const res = await fetch('/api/data', { credentials: 'include' });
  if (!res.ok) { alert('Не вдалось завантажити дані. Залогінься на /app і спробуй ще раз.'); return; }
  const db = await res.json();
  db.materials = db.materials || [];
  db.products = db.products || [];
  log(`Поточний стан: ${db.materials.length} матеріалів, ${db.products.length} продуктів`);

  // --- 2. Утиліти
  const uid = () => 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  const norm = s => (s || '').toLowerCase().replace(/[\s'''"`ʼ]/g, '').replace(/²/g, '2');
  const findMat = (patterns) => {
    for (const p of patterns) {
      const np = norm(p);
      const hit = db.materials.find(m => norm(m.name).includes(np));
      if (hit) return hit;
    }
    return null;
  };

  // --- 3. Описи матеріалів (key → спосіб знайти/створити)
  const matDefs = {
    // Існуючі (знайдемо за фрагментом назви)
    ring_20:         { find: ['Кільця 20'], create: null },
    ring_35:         { find: ['Кільця 35'], create: null },
    ring_40:         { find: ['Кільця 40'], create: null },
    folder_a5:       { find: ['Папки для PECS', 'Папка A5'], create: { name:'Папки для PECS', unit:'шт', qty:0, min:2, price:0, supplier:'', note:'Папка A5 на кнопці' } },
    marker_write:    { find: ['Маркер Пиши', 'Маркер Пиши-Стирай'], create: null },
    paper_a4_200_2s: { find: ['A4 двосторонній глянець 200', 'A4 двост', 'A4 двосторонній 200'], create: null },
    paper_a4_90_sc:  { find: ['A4 самоклейка', 'самоклейка 90', 'A4 самоклейка 90'], create: null },
    film_a4_125:     { find: ['ламінування Galaxy A4 125', 'ламінування A4 125', 'плівка A4 125'], create: null },
    film_a5_125:     { find: ['ламінування Galaxy A5 125', 'ламінування A5 125', 'плівка A5 125'], create: null },

    // Нові (створимо якщо відсутні)
    paper_a4_200_1s: { find: ['Папір А4 200 г/м² односторонній'], create: { name:'Папір А4 200 г/м² односторонній', unit:'аркуш', qty:0, min:0, price:0, supplier:'', note:'' } },
    paper_a4_180_1s: { find: ['Папір А4 180 г/м² односторонній'], create: { name:'Папір А4 180 г/м² односторонній', unit:'аркуш', qty:0, min:0, price:0, supplier:'', note:'' } },
    paper_a4_80_off: { find: ['Папір А4 80 г/м² офісний'],        create: { name:'Папір А4 80 г/м² офісний', unit:'аркуш', qty:0, min:0, price:0, supplier:'', note:'' } },
    paper_a5_200_2s: { find: ['Папір А5 200 г/м² двосторонній'],  create: { name:'Папір А5 200 г/м² двосторонній', unit:'аркуш', qty:0, min:0, price:0, supplier:'', note:'' } },
    paper_a5_180_1s: { find: ['Папір А5 180 г/м² односторонній'], create: { name:'Папір А5 180 г/м² односторонній', unit:'аркуш', qty:0, min:0, price:0, supplier:'', note:'' } },
    paper_a5_300:    { find: ['Папір А5 300 г/м² щільний'],        create: { name:'Папір А5 300 г/м² щільний', unit:'аркуш', qty:0, min:0, price:0, supplier:'', note:'' } },
    paper_a5_sc:     { find: ['Папір А5 самоклеючий'],             create: { name:'Папір А5 самоклеючий', unit:'аркуш', qty:0, min:0, price:0, supplier:'', note:'' } },
    velcro_hard:     { find: ['Ліпучки жорсткі стандартні'],       create: { name:'Ліпучки жорсткі стандартні', unit:'шт', qty:0, min:0, price:0, supplier:'AliExpress', note:'' } },
    velcro_soft:     { find: ['Ліпучки м\'які стандартні', 'Ліпучки мякі стандартні'], create: { name:'Ліпучки м\'які стандартні', unit:'шт', qty:0, min:0, price:0, supplier:'AliExpress', note:'' } },
    velcro_10_hard:  { find: ['Ліпучки 10 мм жорсткі'],            create: { name:'Ліпучки 10 мм жорсткі', unit:'шт', qty:0, min:0, price:0, supplier:'AliExpress', note:'Дрібні 10 мм' } },
    velcro_10_soft:  { find: ['Ліпучки 10 мм м\'які', 'Ліпучки 10 мм мякі'], create: { name:'Ліпучки 10 мм м\'які', unit:'шт', qty:0, min:0, price:0, supplier:'AliExpress', note:'Дрібні 10 мм' } },
    ring_25:         { find: ['Кільця 25 мм'],                     create: { name:'Кільця 25 мм', unit:'шт', qty:0, min:0, price:0, supplier:'hm-furnitura.com', note:'' } },
    ring_30:         { find: ['Кільця 30 мм'],                     create: { name:'Кільця 30 мм', unit:'шт', qty:0, min:0, price:0, supplier:'hm-furnitura.com', note:'Металеві' } },
    folder_a6:       { find: ['Папки на кнопці А6', 'папки А6'],   create: { name:'Папки на кнопці А6', unit:'шт', qty:0, min:0, price:0, supplier:'', note:'' } },
    zip_a4:          { find: ['Зіп-пакет А4', 'зіп-пакети А4'],    create: { name:'Зіп-пакет А4', unit:'шт', qty:0, min:0, price:0, supplier:'Варшавський ринок', note:'' } },
    zip_a5:          { find: ['Зіп-пакет А5', 'зіп-пакети А5'],    create: { name:'Зіп-пакет А5', unit:'шт', qty:0, min:0, price:0, supplier:'Варшавський ринок', note:'' } },
    zip_30x40:       { find: ['Зіп-пакет 30×40', 'зіп-пакет 30x40', 'Зіп-пакет 30'], create: { name:'Зіп-пакет 30×40 см', unit:'шт', qty:0, min:0, price:0, supplier:'Варшавський ринок', note:'' } },
    box_a4_1cm:      { find: ['Коробка А4 h=1', 'Коробка А4 1 см'], create: { name:'Коробка А4 h=1 см', unit:'шт', qty:0, min:0, price:0, supplier:'', note:'' } },
    box_a5_1cm:      { find: ['Коробка А5 h=1', 'Коробка А5 1 см'], create: { name:'Коробка А5 h=1 см', unit:'шт', qty:0, min:0, price:0, supplier:'', note:'' } },
    box_34x24:       { find: ['Коробка 34×24×4', 'коробка 34x24x4', 'НП 1кг 34'], create: { name:'Коробка 34×24×4 см (1 кг НП)', unit:'шт', qty:0, min:0, price:0, supplier:'Нова Пошта', note:'Під 1 кг' } },
    plasticine:      { find: ['Пластилін Школярик'],               create: { name:'Пластилін Школярик 6 кольорів', unit:'компл', qty:0, min:0, price:0, supplier:'', note:'' } },
  };

  // --- 4. Зіставити ID матеріалів (створити відсутні)
  const matId = {};  // key → materialId
  let addedMats = 0, missingMats = [];
  for (const [key, def] of Object.entries(matDefs)) {
    let hit = findMat(def.find);
    if (!hit && def.create) {
      const newMat = { id: uid(), ...def.create };
      db.materials.push(newMat);
      hit = newMat;
      addedMats++;
      log(`+ матеріал: ${newMat.name}`);
    }
    if (!hit) { missingMats.push(key); continue; }
    matId[key] = hit.id;
  }
  if (missingMats.length) warn('Не знайдено і не створено:', missingMats);

  // --- 5. Рецепти ігор
  const games = [
    {
      sku: '', // користувач додасть пізніше
      name: 'Правила безпеки для дітей 3–10 років',
      category: 'Навчальні ігри',
      size: 'А4 • 90 карток + 8 ігрових полів',
      sellPrice: 0,
      recipe: [
        { k:'paper_a4_180_1s', qty:8 }, // основи (user: 180)
        { k:'film_a4_125',     qty:14 }, // 8 + 6
        { k:'paper_a4_90_sc',  qty:2 }, // самоклеючий
        { k:'paper_a4_200_1s', qty:6 }, // деталі
        { k:'box_a4_1cm',      qty:1 },
        { k:'velcro_hard',     qty:9 },
        { k:'velcro_soft',     qty:9 },
      ],
    },
    {
      sku: '',
      name: 'Мотиваційні пригоди',
      category: 'Навчальні ігри',
      size: 'А5',
      sellPrice: 0,
      recipe: [
        { k:'folder_a6',       qty:1 },
        { k:'paper_a5_300',    qty:5 },
        { k:'paper_a4_80_off', qty:1 },
        { k:'paper_a5_sc',     qty:0.5 }, // піваркуша
        { k:'velcro_hard',     qty:54 },
        { k:'velcro_soft',     qty:22 },
      ],
    },
    {
      sku: 'LP-121-2SQ',
      name: 'PECS старий (альбом комунікативних карток)',
      category: 'PECS',
      size: '',
      sellPrice: 3000,
      recipe: [
        { k:'folder_a5',       qty:1 },
        { k:'ring_40',         qty:2 },
        { k:'paper_a4_200_2s', qty:10 }, // основи двосторонні (user: 200)
        { k:'paper_a4_180_1s', qty:20 },
        { k:'film_a4_125',     qty:30 },
        { k:'velcro_hard',     qty:480 },
        { k:'velcro_soft',     qty:455 },
        { k:'zip_30x40',       qty:1 },
      ],
    },
    {
      sku: 'LP-09254',
      name: 'Конструктор дитяче меню',
      category: 'Навчальні ігри',
      size: 'А5',
      sellPrice: 0,
      recipe: [
        { k:'ring_20',         qty:2 },
        { k:'paper_a5_200_2s', qty:5 },
        { k:'paper_a5_180_1s', qty:2 },
        { k:'velcro_10_hard',  qty:60 },
        { k:'velcro_10_soft',  qty:50 },
        { k:'zip_a5',          qty:1 },
      ],
    },
    {
      sku: 'LP-102002',
      name: 'Багаторазовий календар для дітей',
      category: 'Навчальні ігри',
      size: 'А4',
      sellPrice: 500,
      recipe: [
        { k:'ring_25',         qty:8 },
        { k:'paper_a4_180_1s', qty:7 }, // 4 основи + 3 деталі
        { k:'film_a4_125',     qty:7 },
        { k:'velcro_hard',     qty:70 },
        { k:'velcro_soft',     qty:60 },
        { k:'marker_write',    qty:1 },
        { k:'zip_a4',          qty:1 },
        { k:'box_a4_1cm',      qty:1 },
      ],
    },
    {
      sku: 'LP-185-A5',
      name: 'Візуальний розклад "Сплануй свій день" (для дівчаток)',
      category: 'Візуальні розклади',
      size: 'А5',
      sellPrice: 0,
      recipe: [
        { k:'folder_a5',       qty:1 },
        { k:'ring_25',         qty:2 },
        { k:'paper_a5_200_2s', qty:3 },
        { k:'paper_a5_180_1s', qty:5 },
        { k:'film_a5_125',     qty:4 },
        { k:'film_a4_125',     qty:4 },
        { k:'velcro_hard',     qty:100 },
        { k:'velcro_soft',     qty:60 },
        { k:'box_a5_1cm',      qty:1 },
      ],
    },
    {
      sku: 'LP-101202',
      name: 'Пластилін для самих маленьких (10 ігор)',
      category: 'Сенсорні ігри',
      size: 'А5',
      sellPrice: 300,
      recipe: [
        { k:'ring_25',         qty:2 },
        { k:'plasticine',      qty:1 },
        { k:'film_a5_125',     qty:6 },
        { k:'paper_a5_200_2s', qty:3 },
        { k:'zip_a5',          qty:1 },
      ],
    },
    {
      sku: 'LP102108',
      name: 'Багаторазовий зошит "Пиши-стирай"',
      category: 'Навчальні ігри',
      size: 'А5',
      sellPrice: 450,
      recipe: [
        { k:'ring_25',         qty:2 },
        { k:'marker_write',    qty:2 },
        { k:'film_a5_125',     qty:24 },
        { k:'paper_a5_200_2s', qty:13 },
        { k:'zip_a5',          qty:1 },
      ],
    },
    {
      sku: 'LP-124-7A5',
      name: 'Фразовий конструктор першого речення (120 карток)',
      category: 'Мовні ігри',
      size: 'А4',
      sellPrice: 750,
      recipe: [
        { k:'paper_a4_90_sc',  qty:1 },
        { k:'paper_a4_180_1s', qty:11 },
        { k:'film_a4_125',     qty:11 },
        { k:'velcro_soft',     qty:120 },
        { k:'velcro_hard',     qty:10 },
        // особливу коробку — додаси пізніше
      ],
    },
    {
      sku: 'LP-1250A4',
      name: 'PECS Mini (216 карток)',
      category: 'PECS',
      size: 'А4',
      sellPrice: 1800,
      recipe: [
        { k:'zip_a4',          qty:1 },
        { k:'box_34x24',       qty:1 },
        { k:'ring_30',         qty:2 },
        { k:'paper_a4_200_2s', qty:6 },
        { k:'paper_a4_180_1s', qty:12 },
        { k:'film_a5_125',     qty:3 },
        { k:'film_a4_125',     qty:17 },
        { k:'velcro_soft',     qty:230 },
        { k:'velcro_hard',     qty:230 },
      ],
    },
  ];

  // --- 6. Додати продукти (дедуплікація за SKU/назвою)
  let addedProds = 0, skippedProds = 0;
  for (const g of games) {
    const existing = db.products.find(p =>
      (g.sku && p.sku === g.sku) ||
      (!g.sku && p.name === g.name)
    );
    if (existing) {
      skippedProds++;
      warn(`↻ вже існує, пропускаю: ${g.name}`);
      continue;
    }
    const recipe = g.recipe
      .filter(r => matId[r.k])
      .map(r => ({ materialId: matId[r.k], qty: r.qty }));
    const missing = g.recipe.filter(r => !matId[r.k]).map(r => r.k);
    if (missing.length) warn(`! у "${g.name}" пропущено матеріали:`, missing);

    db.products.push({
      id: uid(),
      sku: g.sku || '',
      name: g.name,
      size: g.size || '',
      category: g.category || '',
      pages: 0,
      sellPrice: g.sellPrice || 0,
      workerRate: 25,
      workerRateType: 'percent',
      packagingKitId: '',
      packagingCost: 0,
      templateCost: 0,
      templateQty: 0,
      recipe,
      stock: 0,
      inProgress: 0,
      active: true,
    });
    addedProds++;
    log(`+ гра: ${g.name} (${recipe.length} матеріалів у рецепті)`);
  }

  // --- 7. Зберегти
  log('Зберігаю...');
  const saveRes = await fetch('/api/data', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(db),
  });
  if (!saveRes.ok) {
    alert('❌ Помилка збереження. Дивись консоль.');
    console.error(await saveRes.text());
    return;
  }

  console.log('%c✅ Готово!', 'color:#27ae60;font-size:18px;font-weight:bold');
  console.log(`   + ${addedMats} нових матеріалів`);
  console.log(`   + ${addedProds} нових ігор`);
  console.log(`   ↻ ${skippedProds} пропущено (вже існували)`);
  console.log('');
  console.log('👉 Перезавантаж сторінку (Cmd+R), щоб побачити зміни.');
  alert(`✅ Готово!\n\n+${addedMats} матеріалів\n+${addedProds} ігор\n\nПерезавантаж сторінку (Cmd+R).`);
})();
