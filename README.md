<!-- Branch Orders -->

# Branch Orders — نظام طلبات الفروع

Web app (AR/EN · RTL/LTR) لإدارة طلبات المشتريات بين الفروع: الإنشاء، المتابعة، الاستلام، وحفظ النقص.

نسختان من الباك اند، تختارهما من `config.js`:

```
┌─────────────────────────────┐
│  GitHub Pages (static)       │
│  frontend/                   │
│  HTML/CSS/ES modules         │
└──────────────┬──────────────┘
               │
     ┌─────────┴──────────┐
     │  الوضع المحلي (افتراضي)   │
     │  assets/js/backend/*   │   ← باك اند كامل داخل المتصفح
     │  بيانات localStorage   │   ← صفر خدمات خارجية، صفر إعداد
     └─────────┬──────────┘
     ┌─────────┴──────────┐
     │  وضع السحابة (اختياري)    │
     │  Google Apps Script +    │   ← مشاركة البيانات بين كل الأجهزة
     │  Google Sheets (بيانات)   │
     └─────────────────────┘
```

- **الوضع المحلي (`DATA_MODE:'local'` — الافتراضي):** كل الباك اند يعمل داخل المتصفح (ملفات `frontend/assets/js/backend/`)، وقاعدة البيانات في `localStorage`. يكفي رفع `frontend/` على GitHub Pages — لا حسابات ولا روابط ولا CORS. البيانات محفوظة على **جهاز/متصفح المستخدم نفسه**.
- **وضع السحابة (`DATA_MODE:'google'`):** نفس الواجهة تعمل مع Google Apps Script + Sheets (الجزء الثاني أدناه)، للفرق التي تحتاج قاعدة بيانات مشتركة بين الأجهزة.

## إعداد سريع (الوضع المحلي — افتراضي، بدون أي خدمة خارجية)

| الخطوة | أين |
|---|---|
| 1. أبقِ `DATA_MODE:'local'` في `frontend/assets/js/config.js` (الافتراضي) | `config.js` |
| 2. ارفع مجلد `frontend/` على GitHub Pages عبر `git init` + دفع + workflow | github.com |
| 3. افتح الرابط: أول دخول = أنشئ حساب الأدمن الأول (الكرت يظهر تلقائياً)، أو حمّل البيانات التجريبية بضغطة زر | المتصفح |

لا تحتاج Google Sheets ولا Apps Script ولا أي مفاتيح. النسخ الاحتياطي: **لوحة الإدارة ← Backup (تصدير/استيراد JSON)**.

## إعداد سريع (وضع السحابة — اختياري)

| الخطوة | أين |
|---|---|
| 1. غيّر `DATA_MODE:'google'` وضع `API_URL` في `config.js` | `config.js` |
| 2. أنشئ Spreadsheet جديد (احفظه باسم Branch Orders) | sheets.google.com |
| 3. التمديدات ← Apps Script | من Spreadsheet |
| 4. الصق محتويات `backend/*.gs` بالترتيب الموجود في `backend/` + `appsscript.json` | محرر Apps Script |
| 5. شغّل `setupSystem()` ثم `createFirstAdmin('admin','YourPass@123','Admin User')` | المحرر (أو القائمة بعد فتح الجدول) |
| 6. نشر ← Web app (Execute as: Me، Access: Anyone) وانقل الرابط الناتج | Apps Script → Deploy |
| 7. ضع الرابط في `API_URL` ثم ارفع `frontend/` على GitHub Pages | `config.js` + Actions |

## بنية المجلدات

```
branch-orders/
├── backend/              ← باك اند السحابة فقط (Apps Script — يدار بـ clasp أو لصق يدوي)
│   ├── Code.gs           HTTP layer + ROUTES (guards: public/auth/admin)
│   ├── Config.gs         الإعدادات والثوابت + fail()/ApiError/nowIso()
│   ├── SheetsRepo.gs     مستودع جداول البيانات (صف أول = العناوين) + Ids
│   ├── AuthService.gs    SHA-256 متكرر 12000 + جلسات + عزل الفروع
│   ├── ActivityService.gs  سجل أحداث
│   ├── CatalogService.gs   الفروع/المستخدمون/الأصناف/التوافر
│   ├── OrderService.gs     دورة حياة الطلب (مسودة→...→استلام/نقص)
│   ├── AdminService.gs     مقاييس لوحة الإدارة
│   ├── ReportingService.gs تقارير + تصدير CSV (بدون أسرار)
│   ├── Setup.gs           setupSystem / createFirstAdmin / loadDemoData
│   ├── Ui.gs              قوائم Spreadsheet (onOpen)
│   ├── appsscript.json    Manifest
│   └── .clasp.json.example
├── frontend/             ← واجهة ثابتة (ES modules، لا build step)
│   ├── index.html
│   ├── assets/css/styles.css
│   ├── assets/js/config.js   ← DATA_MODE: 'local' (افتراضي) أو 'google' + API_URL
│   ├── assets/js/app.js      راوتر + shell + guard الأدوار
│   ├── assets/js/backend/    ← باك اند المتصفح (نفس منطق backend/ بنسخة JS):
│   │                          routes.js (dispatch) + store.js (localStorage) + auth.js ...
│   └── assets/js/views/      login.js / branch.js / admin.js
├── tests/                ← اختبارات Node (لا تتطلب متصفحاً)
│   ├── appsscript-shim.mjs   محاكاة SpreadsheetApp/LockService/Utilities...
│   ├── shared-suite.mjs      147 اختباراً مشتركاً بين نسختي الباك اند
│   ├── run-backend-tests.mjs     تشغيلها على باك اند Apps Script (shim)
│   ├── run-local-backend-tests.mjs  تشغيلها على باك اند المتصفح (dispatch + localStorage stub)
│   ├── serve-local.mjs      خادم تجريبي يحاكي API السحابة
│   └── check-frontend.mjs    فحص مفاتيح i18n + الأيقونات
├── .github/workflows/pages.yml  ← نشر تلقائي لـ frontend/ على Pages
└── package.json
```

---

## الجزء 1 — الباك اند (Google Apps Script)

### 1.1 تجهيز الجدول

1. افتح [sheets.google.com](https://sheets.google.com) وأنشئ جدولاً جديداً، اسمه مثلاً `Branch Orders`.
2. من القائمة **Extensions → Apps Script** افتح المحرر (سيُحدَّث اليها مباشرة).
3. في المحرر: الصق **كل ملف من `backend/` كـ file script منفصل** بنفس أسماء الملفات، ثم انسخ `appsscript.json` (File → Project settings → check "Show appsscript.json manifest file" ثم الصق).
   - الترتيب لا يهم للتشغيل، لكن يُنصح بالحفاظ على بنية الملفات لو استخدمت `clasp`.
4. احفظ وشغّل `setupSystem()` (تُنشئ كل الأوراق والعناوين؛ إعادة التشغيل آمنة جداً).

### 1.2 أول حساب أدمن

من المحرر (أو بعد فتح الجدول من القائمة **Branch Orders → Create first admin**):

```javascript
createFirstAdmin('admin', 'YourPass@123', 'System Admin');
```

> لا يمكن إنشاء الأدمن الأول إلا بهذه الشكل. بعده أضف أي مستخدم من لوحة الإدارة.

### 1.3 بيانات تجريبية (اختياري)

```javascript
loadDemoData();
```

- فروع: `Cairo – Nasr City (BR-001)`، `Alexandria – Sidi Gaber (BR-002)`، `Giza – Dokki (BR-003)`.
- 12 صنفاً + ربطها بكل الفروع.
- مستخدمون (كلمة السر للجميع: `Demo@1234`): أدمن `admin.demo` · فروع `ali.ahmed` (BR-001) · `mona.hassan` (BR-002) · `kareem.said` (BR-003).
- 3 طلبات في حالات مختلفة لإظهار اللوحات.
- إعادة التشغيل ترفض (`DEMO_LOADED=true`). لإعادة التحميل امسح صف `DEMO_LOADED` من ورقة Settings.

### 1.4 نشر الـ Web App

1. Apps Script ← **Deploy → New deployment → Web app**.
2. `Execute as`: خيارك (الموصى به: `Me`؛ والمشروع يعتمد على SpreadsheetApp النشط عند أول تضمين).
   `Access`: **Anyone** (التحقق من الجهة من داخل الكود عبر الجلسات؛ لا بيانات حساسة عامة).
3. انسخ رابط الويب الناتج `https://script.google.com/macros/s/XXXX/exec`.

> CORS: الـ API يرد بإذن لأي origin (`Access-Control-Allow-Origin: *`) ويرسل الـ POST عبر `Content-Type: text/plain` لتجنّب طلب preflight — وهذا ما يجعله يعمل من أي صفحة GitHub Pages.

### 1.5 النشر عبر clasp (اختياري — أسرع للتحديثات)

```bash
npm i -g @google/clasp
cd backend
cp .clasp.json.example .clasp.json     # ضع scriptId الخاص بك (الإعدادات ← معرف المشروع)
clasp login
clasp push                              # يرفع كل .gs + appsscript.json
clasp deploy -i <deploymentId>          # أو أنشئ deployment جديد
```

---

## الجزء 2 — الواجهة الأمامية (GitHub Pages)

### 2.1 الوضع المحلي (افتراضي)

- `DATA_MODE:'local'` في `config.js`: لا حاجة لأي رابط. شاشة "غير موصولة" لن تظهر، وأول زيارة تعرض كرت إنشاء الأدمن الأول (أو تحميل الديمو).
- تشغيل محلي: `npm run serve` ثم افتح `http://localhost:8080`.
- البيانات في `localStorage` لحساب المتصفح: Backup/استيراد/إعادة تعيين من **لوحة الإدارة ← قسم الصيانة** (لا يظهر إلا في الوضع المحلي).

### 2.2 ضبط وضع السحابة

غيّر `DATA_MODE:'google'` في `frontend/assets/js/config.js` واستبدل `YOUR_SCRIPT_ID` برابط Web App الفعلي:

```javascript
const DATA_MODE = 'google';
const API_URL = 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec';
```

> في وضع السحابة فقط: يعرض التطبيق شاشة "المنصة غير موصولة" حتى يُضبط الرابط (فحص `isConfigured()`).

### 2.3 تشغيل محلي

```bash
npm run serve          # يعمل على: http://localhost:8080
# أو:  python -m http.server 8080  (من داخل frontend/)
```

جرب الدخول بـ `admin / YourPass@123` (أو الديمو: `admin.demo / Demo@1234` للأدمن، و`ali.ahmed / Demo@1234` للفرع).

### 2.4 النشر على GitHub Pages

1. ارفع المشروع إلى repo جديد:
   ```bash
   git init && git add . && git commit -m "Branch orders app"
   git remote add origin https://github.com/<you>/branch-orders.git
   git push -u origin main
   ```
2. الـ workflow `.github/workflows/pages.yml` ينشر `frontend/` تلقائياً.
3. من repo الإعدادات: **Settings → Pages → Source: GitHub Actions**.
4. الرابط: `https://<you>.github.io/branch-orders/`.

> التحديثات على الفرع الرئيسي داخل `frontend/**` تعيد النشر تلقائياً.

---

## الأدوار وسير العمل

| الدور | الصلاحيات |
|---|---|
| `branch_user` | مسودات الطلبات، الإرسال، الإلغاء للمسودات، متابعة طلبات **فرعه فقط**، الاستلام وتسجيل النقص، تغيير كلمة السر |
| `admin` | كل الطلبات وكل الفروع، اعتماد/معالجة/شحن/إلغاء، إعادة فتح الاستلام، إدارة الفروع/المستخدمين/الأصناف/التوافر، التقارير وتصدير CSV |

حالة الطلب: `draft → submitted → approved → processing → sent → received` (+ `partially_received` و `shortage_reported` عند النقص، و `cancelled`). كل تحويلة تُتحقق: مثلاً `received → processing` ممنوعة، و `sent → approved` ممنوعة؛ الاستلام الناقص يُعاد فتحه بالأدمن فقط (وإلا كل طلب بأقل من المُرسل يُعرض بنقص).

### قواعد حماية في الخادم (لا يعتمد على المتصفح)
- عزل الفروع: كل سؤال يقرأ طلباً أو يعدّله يتحقق من `branch_id` (أو `created_by`) ويرفض الاعتراض.
- الأدمن يمنع الأدمن الأخير من إلغاء نفسه (`last_active_admin`).
- كلمات المرور: `sha256$12000$salt$hash` — لا تُخزن أبداً كنص، ولا تظهر في أي رد أو CSV.
- الجلسات في ورقة `Sessions` (انتهاء تلقائي بـ `SESSION_HOURS`؛ تعطيل/حذف المستخدم يبطلها فوراً).
- لا مفاتيح سرية في الواجهة؛ الرابط الوحيد هو للـ Web App نفسه.

---

## الإعدادات (يسط Properties للأدمن، اختياري)

من Apps Script ← **Project Settings → Script properties**:

| Key | الافتراضي | الوصف |
|---|---|---|
| `TIMEZONE` | `Africa/Cairo` | منطقة التوقيت للتوقيعات |
| `SESSION_HOURS` | `12` | ساعات انتهاء الجلسة |
| `ALLOW_DECIMAL_QTY` | `false` | إتاحة كميات عشرية |
| `REQUIRE_APPROVAL` | `true` | إلزام خطوة الاعتماد (لإبطاله: تمرير `submitted → processing` مباشرة) |
| `MAX_QTY_PER_ITEM` | `9999` | سقف أمان إضافي للكمية الواحدة |

---

## الاختبارات

```bash
npm test                      # نسختا الباك اند + فحص الواجهة
npm run syntax                # فحص صياغة كل ملفات JS الأمامية (بما فيها backend/)
```

- `tests/shared-suite.mjs` — 147 اختباراً مشتركاً، تُشغَّل على نسختي الباك اند:
  - `tests/run-backend-tests.mjs` — على باك اند Apps Script (محاكاة كاملة لـ SpreadsheetApp).
  - `tests/run-local-backend-tests.mjs` — على باك اند المتصفح (نفس الاستدعاءات عبر `dispatch()` مع localStorage stub)؛ نفس الأرقام والنواتج.
  - تغطي: الإعداد الأولي والأدمن الأول والديمو (وتكرارهم يُرفض).
  - الإعداد الأولي والأدمن الأول والديمو (وتكرارهم تُرفض).
  - مصادقة: نجاح/فشل/مستخدم مجهول/جلسة منتهية؛ **فحص عدم تسريب كلمات المرور في أي رد**.
  - دورة الطلب: مسودة → حفظ → إرسال → اعتماد (مع تجاوز الكميات) → معالجة → شحن → استلام كامل/ناقص (reason)، منع إعادة الاستلام، إعادة الفتح.
  - أخطاء: صنف غير متاح، تجاوز الحد الأقصى، طلب فارغ، صنف مجهول، استلام أكبر من المُرسل، سالب، استلام غير مسموح.
  - عزل: مستخدم فرع لا يرى/يعدّل/يلغي طلبات غيره، والأدمن يراهم جميعاً مع فلاتر وتصفح.
  - حماية: إلغاء آخر أدمن ممنوع، تعطيل مستخدم/فرع يمنع الدخول، كلمات مرور ضعيفة مرفوضة، اسم مستخدم/كود فرع مكرر مرفوض.
  - تقارير/CSV/مقاييس: المجاميع، الفلاتر، **استحقان CSV بلا عمود password**.
  - التزامنية: 40 مسودة متزامنة تنتج 40 رقم طلب فريد (المعرفات تحت LockService).
- `tests/check-frontend.mjs` — يفحص أن كل `t('...')` موجود في AR و EN، وكل `icon('...')` موجود في icon set.

> النتائج حالياً: **147/147 نجحت لكل نسخة** من الباك اند، ومفاتيح الواجهة والأيقونات مكتملة.

---

## حل المشاكل

| المشكلة | الحل |
|---|---|
| "المنصة غير موصولة" (وضع سحابة) | لم تُوضع `API_URL` في `config.js` أو الرابط لا ينتهي بـ `/exec` |
| أريد التشغيل بدون أي خدمات | راجع قسم "الوضع المحلي": `DATA_MODE:'local'` هو الافتراضي ولا يحتاج شيئاً |
| بيانات localStorage اختفت | Backup من لوحة الإدارة على جهاز/متصفح آخر، أو زر Reset — البيانات في جهاز المستخدم نفسه وليس الخادم |
| Web App يعيد الملف الأصلي HTML بدلاً من JSON | عند الطلب الأول من متصفح قد يحدث؛ يُنصح بفتح الرابط مرة ثم إعادة التحميل. انشر `Web app` بالتحديد |
| صفحة فارغة بعد الدخول | سجّل الخروج وأعد الدخول؛ تأكد أن `Users` فيها `branch_id` صحيح لمستخدم الفرع |
| تغييرات الباك اند لا تظهر | انشر deployment جديداً في Apps Script وحدّث الرابط إن تغيّر |
| أرقام الطلبات بدأت من رقمك الحالي | التعذيذ سجّل Sequencer في `Settings` (`seq.order`). لن تختفي الأرقام من دون مسح هذه الخلايا |
| بيانات مفقودة | انسخ الجدول (النسخ الاحتياطي) — لا تحذف أوراق تحت التطبيق |

## النسخ الاحتياطي

- **الوضع المحلي:** لوحة الإدارة ← قسم الصيانة ← **تصدير نسخة JSON / استيرادتها** (يوجد أيضاً Reset). البيانات في متصفحك؛ نقلها لجهاز آخر يتم بالنسخة المصدَّرة.
- **وضع السحابة:** الجدول هو قاعدة البيانات: «File → Make a copy» يكفي كنسخة احتياطية، وبعدها عودة الرابط للنسخة.

> ملاحظة: المشروع حالياً ليس repo git؛ ابدأ بـ `git init` كما في قسم النشر.