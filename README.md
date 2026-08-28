<!-- Branch Orders -->

# Branch Orders — نظام طلبات الفروع

Web app (AR/EN · RTL/LTR) لإدارة طلبات المشتريات بين الفروع: الإنشاء، المتابعة، الاستلام، وحفظ النقص.

الواجهة على GitHub Pages، والبيانات على Google Sheets عبر Apps Script:

```
┌─────────────────────────────┐
│  GitHub Pages (static)       │
│  frontend/                   │
│  HTML/CSS/ES modules         │
└──────────────┬──────────────┘
               │  POST /exec
┌──────────────┴──────────────┐
│  Google Apps Script + Sheets │  ← قاعدة مشتركة لكل الأجهزة
│  backend/*.gs                │  ← ينشر تلقائياً من GitHub
└─────────────────────────────┘
```

## إعداد سريع

| الخطوة | أين |
|---|---|
| 1. أنشئ Spreadsheet جديد (احفظه باسم Branch Orders) | sheets.google.com |
| 2. التمديدات ← Apps Script | من Spreadsheet |
| 3. اربط المشروع بـ GitHub (مرة واحدة، §1.5) — بعدها أي تعديل على `backend/` ينشر تلقائياً | GitHub Actions + clasp |
| 4. شغّل `setupSystem()` ثم `createFirstAdmin('admin','YourPass@123','Admin User')` | المحرر (أو القائمة بعد فتح الجدول) |
| 5. نشر ← Web app (Execute as: Me، Access: Anyone) **مرة واحدة** وانسخ الرابط | Apps Script → Deploy |
| 6. ضع الرابط في `API_URL` داخل `config.js` ثم ارفع `frontend/` على GitHub Pages | `config.js` + Actions |

## بنية المجلدات

```
branch-orders/
├── backend/              ← باك اند Apps Script (ينشر تلقائياً من GitHub)
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
├── scripts/
│   ├── deploy-appsscript.mjs          إعادة نشر نفس رابط /exec
│   └── setup-appsscript-github.mjs    مرة واحدة: أسرار GitHub
├── frontend/             ← واجهة ثابتة (ES modules، لا build step)
│   ├── index.html
│   ├── assets/css/styles.css
│   ├── assets/js/config.js   ← API_URL لرابط Web App
│   ├── assets/js/api.js      يستدعي Apps Script (POST text/plain)
│   └── assets/js/views/      login.js / branch.js / admin.js
├── tests/                ← اختبارات Node (محاكاة SpreadsheetApp)
│   ├── appsscript-shim.mjs   محاكاة SpreadsheetApp/LockService/Utilities...
│   ├── shared-suite.mjs      147 اختباراً مشتركاً بين نسختي الباك اند
│   ├── run-backend-tests.mjs     تشغيلها على باك اند Apps Script (shim)
│   ├── serve-local.mjs      خادم تجريبي يحاكي API السحابة
│   └── check-frontend.mjs    فحص مفاتيح i18n + الأيقونات
├── .github/workflows/pages.yml              ← نشر تلقائي لـ frontend/ على Pages
├── .github/workflows/deploy-appsscript.yml  ← نشر تلقائي لـ backend/ على Apps Script
└── package.json
```

---

## الجزء 1 — الباك اند (Google Apps Script)

### 1.1 تجهيز الجدول

1. افتح [sheets.google.com](https://sheets.google.com) وأنشئ جدولاً جديداً، اسمه مثلاً `Branch Orders`.
2. من القائمة **Extensions → Apps Script** افتح المحرر (يكفي مشروع فارغ في أول مرة).
3. ارفع الكود من GitHub (موصى به — [§1.5](#15-النشر-التلقائي-من-github--بدون-لصق-يدوي)) أو الصق الملفات يدوياً مرة واحدة:
   - كل ملف من `backend/*.gs` كـ script منفصل بنفس الاسم + `appsscript.json` (File → Project settings → "Show appsscript.json").
4. شغّل `setupSystem()` (تُنشئ كل الأوراق والعناوين؛ إعادة التشغيل آمنة جداً).

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

### 1.5 النشر التلقائي من GitHub — بدون لصق يدوي

أي دفع على `main` يغيّر `backend/**` يرفع الملفات إلى Apps Script ويعيد نشر **نفس** رابط `/exec` (الواجهة لا تحتاج رابطاً جديداً).

هذا إعداد **مرة واحدة**. بعده المصدر هو GitHub؛ لا تعدّل في محرر Apps Script وإلا الـ Action سيستبدل التعديل.

#### أ) مرة واحدة على Google

1. فعّل [Apps Script API](https://script.google.com/home/usersettings) للحساب الذي يملك المشروع.
2. من المحرر: **Project Settings** ← انسخ **Script ID**.
3. أنشئ نشر Web app **مرة واحدة** إن لم يكن موجوداً: **Deploy → New deployment → Web app**  
   (`Execute as: Me` · `Access: Anyone`) وانسخ الرابط `.../exec`.
4. **Deployment ID** = الجزء الأوسط من الرابط:

   `https://script.google.com/macros/s/`**`AKfycb...`**`/exec`

#### ب) مرة واحدة على جهازك (Windows)

```powershell
npx @google/clasp@3.4.0 login

copy backend\.clasp.json.example backend\.clasp.json
# افتح backend\.clasp.json والصق Script ID مكان PASTE_YOUR_...

node scripts/setup-appsscript-github.mjs AKfycbYOUR_DEPLOYMENT_ID
```

السكربت يضع ثلاثة GitHub secrets: `CLASPRC_JSON` و `CLASP_JSON` و `APPS_SCRIPT_DEPLOYMENT_ID`.

بدون السكربت، من **Settings → Secrets and variables → Actions**:

| Secret | القيمة |
|---|---|
| `CLASPRC_JSON` | محتوى `%USERPROFILE%\.clasprc.json` بعد `clasp login` |
| `CLASP_JSON` | محتوى `backend\.clasp.json` (فيه `scriptId`) |
| `APPS_SCRIPT_DEPLOYMENT_ID` | `AKfycb...` من رابط `/exec` |

#### ج) بعدها

```powershell
git add backend
git commit -m "Update Apps Script backend"
git push origin main
```

راقب **Actions → Deploy Apps Script**. يدوي: **Actions → Deploy Apps Script → Run workflow**.

> `clasp push` يحدّث كود المحرر فقط. إعادة نشر نفس الـ deployment هي ما تجعل رابط `/exec` الحي يخدم الكود الجديد.

---

## الجزء 2 — الواجهة الأمامية (GitHub Pages)

### 2.1 الربط بالباك اند

`API_URL` في `frontend/assets/js/config.js` يجب أن يكون رابط Web App (ينتهي بـ `/exec`).

للتطوير المحلي ضد محاكاة الباك اند:

```bash
npm run demo:server    # http://localhost:8787/exec
npm run serve          # http://localhost:8080
# ثم افتح: http://localhost:8080/?api=http://localhost:8787/exec
```

### 2.2 تشغيل محلي (مع السحابة الحقيقية)

```bash
npm run serve          # http://localhost:8080
```

الواجهة تستدعي `API_URL` مباشرة. جرب الدخول بعد `setupSystem` / الأدمن الأول، أو الديمو: `admin.demo / Demo@1234` و `ali.ahmed / Demo@1234`.

### 2.3 النشر على GitHub Pages

1. الـ workflow `.github/workflows/pages.yml` ينشر `frontend/` تلقائياً من `main`.
2. من إعدادات الريبو: **Settings → Pages → Source: GitHub Actions**.
3. الرابط: `https://<you>.github.io/branch-orders/`.

> التحديثات على `frontend/**` تعيد نشر الواجهة. التحديثات على `backend/**` تعيد نشر Apps Script (§1.5).

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
npm test                      # باك اند Apps Script + فحص الواجهة
npm run syntax                # فحص صياغة ملفات JS الأمامية
```

- `tests/shared-suite.mjs` — 147 اختباراً على باك اند Apps Script (محاكاة SpreadsheetApp في `tests/run-backend-tests.mjs`):
  - الإعداد الأولي والأدمن الأول والديمو (وتكرارهم تُرفض).
  - مصادقة: نجاح/فشل/مستخدم مجهول/جلسة منتهية؛ **فحص عدم تسريب كلمات المرور في أي رد**.
  - دورة الطلب: مسودة → حفظ → إرسال → اعتماد (مع تجاوز الكميات) → معالجة → شحن → استلام كامل/ناقص (reason)، منع إعادة الاستلام، إعادة الفتح.
  - أخطاء: صنف غير متاح، تجاوز الحد الأقصى، طلب فارغ، صنف مجهول، استلام أكبر من المُرسل، سالب، استلام غير مسموح.
  - عزل: مستخدم فرع لا يرى/يعدّل/يلغي طلبات غيره، والأدمن يراهم جميعاً مع فلاتر وتصفح.
  - حماية: إلغاء آخر أدمن ممنوع، تعطيل مستخدم/فرع يمنع الدخول، كلمات مرور ضعيفة مرفوضة، اسم مستخدم/كود فرع مكرر مرفوض.
  - تقارير/CSV/مقاييس: المجاميع، الفلاتر، **استحقان CSV بلا عمود password**.
  - التزامنية: 40 مسودة متزامنة تنتج 40 رقم طلب فريد (المعرفات تحت LockService).
- `tests/check-frontend.mjs` — يفحص أن كل `t('...')` موجود في AR و EN، وكل `icon('...')` موجود في icon set.

> النتائج حالياً: **147/147** على باك اند Apps Script، ومفاتيح الواجهة والأيقونات مكتملة.

---

## حل المشاكل

| المشكلة | الحل |
|---|---|
| "المنصة غير موصولة" | لم تُوضع `API_URL` في `config.js` أو الرابط لا ينتهي بـ `/exec`، أو الـ Web app ليس Access: Anyone |
| Web App يعيد HTML بدلاً من JSON | انشر **Web app** بالتحديد (ليس API executable). افتح الرابط مرة ثم أعد التحميل |
| صفحة فارغة بعد الدخول | سجّل الخروج وأعد الدخول؛ تأكد أن `Users` فيها `branch_id` صحيح لمستخدم الفرع |
| تغييرات الباك اند لا تظهر | تأكد أن Action `Deploy Apps Script` نجح على `main`، وأن سر `APPS_SCRIPT_DEPLOYMENT_ID` هو نفس الجزء الأوسط من رابط `/exec` |
| أرقام الطلبات بدأت من رقمك الحالي | التعذيذ سجّل Sequencer في `Settings` (`seq.order`). لن تختفي الأرقام من دون مسح هذه الخلايا |
| بيانات مفقودة | انسخ الجدول (النسخ الاحتياطي) — لا تحذف أوراق تحت التطبيق |

## النسخ الاحتياطي

الجدول هو قاعدة البيانات: «File → Make a copy» يكفي كنسخة احتياطية.

> ملاحظة: الواجهة تُنشر من `frontend/` عبر Pages؛ الباك اند يُنشر من `backend/` عبر `Deploy Apps Script`.