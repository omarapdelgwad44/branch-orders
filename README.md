<!-- Branch Orders -->

# Branch Orders — نظام طلبات الفروع

Web app (AR/EN · RTL/LTR) لإدارة طلبات المشتريات بين الفروع: الإنشاء، المتابعة، الاستلام، وحفظ النقص.

الواجهة على GitHub Pages، والبيانات على **Supabase** (Postgres + Edge Function):

```
┌─────────────────────────────┐
│  GitHub Pages (static)       │
│  frontend/                   │
└──────────────┬──────────────┘
               │  POST JSON
┌──────────────┴──────────────┐
│  Supabase Edge Function      │  /functions/v1/api
│  supabase/functions/         │
│  Postgres (RLS locked)       │
└─────────────────────────────┘
```

## إعداد سريع

| الخطوة | أين |
|---|---|
| 1. أنشئ مشروع مجاني على [supabase.com](https://supabase.com) | New project |
| 2. نفّذ ملف الهجرة في SQL Editor | `supabase/migrations/20260830120000_init.sql` |
| 3. انشر الـ Edge Function (مرة محلياً أو عبر GitHub Actions) | §1.3 |
| 4. ضع رابط الدالة ومفتاح `anon` في `frontend/assets/js/config.js` | `API_URL` + `SUPABASE_ANON_KEY` |
| 5. ارفع `frontend/` على GitHub Pages | Actions → Pages |
| 6. من شاشة الدخول: أنشئ المسؤول الأول، أو حمّل البيانات التجريبية | الواجهة نفسها |

## بنية المجلدات

```
branch-orders/
├── supabase/
│   ├── migrations/           جداول Postgres + next_setting_seq
│   ├── config.toml           verify_jwt = false (جلسات التطبيق)
│   └── functions/
│       ├── api/index.ts      HTTP (Deno)
│       └── _shared/          نفس منطق الـ API (Node + Deno)
├── frontend/                 واجهة ثابتة
│   └── assets/js/config.js   ← API_URL + SUPABASE_ANON_KEY
├── tests/                    اختبارات على نسخة الذاكرة من نفس الـ API
├── .github/workflows/
│   ├── pages.yml             نشر الواجهة
│   └── deploy-supabase.yml   هجرات + Edge Function
└── backend/                  (قديم — Apps Script، لم يعد مستخدماً)
```

---

## الجزء 1 — الباك اند (Supabase)

### 1.1 إنشاء المشروع

1. افتح [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
2. اختر كلمة سر لقاعدة البيانات واحفظها (ستحتاجها لـ GitHub Actions).
3. بعد الجاهزية: **Project Settings → API**
   - `Project URL` مثل `https://abcdefgh.supabase.co`
   - `anon` `public` key
   - `Reference ID` (للنشر التلقائي)

رابط الدالة بعد النشر:

`https://<PROJECT_REF>.supabase.co/functions/v1/api`

### 1.2 الجداول

من **SQL Editor → New query** الصق محتوى `supabase/migrations/20260830120000_init.sql` ثم Run.

أو عبر CLI بعد الربط:

```bash
npx supabase db push
```

الجداول مقفلة بـ RLS بدون سياسات عامة. الواجهة لا تقرأ Postgres مباشرة؛ الـ Edge Function تستخدم `service_role` داخلياً.

### 1.3 نشر الـ Edge Function (مرة محلياً)

```bash
npx supabase login
npx supabase functions deploy api --project-ref YOUR_REF --no-verify-jwt
```

`verify_jwt` معطّل لأن التطبيق يدير جلساته (`token` في جسم الطلب)، وليس جلسات Supabase Auth.

### 1.4 النشر التلقائي من GitHub

أسرار الريبو (**Settings → Secrets and variables → Actions**):

| Secret | من أين |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | [Account → Access Tokens](https://supabase.com/dashboard/account/tokens) |
| `SUPABASE_PROJECT_REF` | Project Settings → General → Reference ID |
| `SUPABASE_DB_PASSWORD` | كلمة سر قاعدة البيانات عند إنشاء المشروع |

بعدها أي دفع يغيّر `supabase/**` على `main` يطبّق الهجرات وينشر الدالة.

### 1.5 أول حساب / بيانات تجريبية

من شاشة الدخول (بعد ربط `config.js`):

- **إنشاء مسؤول** — أو —
- **تحميل بيانات تجريبية**

حسابات الديمو (كلمة السر للجميع: `Demo@1234`):

| المستخدم | الدور |
|---|---|
| `admin.demo` | أدمن |
| `ali.ahmed` | فرع القاهرة |
| `mona.hassan` | فرع الإسكندرية |
| `kareem.said` | فرع الجيزة |

---

## الجزء 2 — الواجهة (GitHub Pages)

### 2.1 الربط بالباك اند

في `frontend/assets/js/config.js`:

```js
API_URL: 'https://YOUR_PROJECT.supabase.co/functions/v1/api',
SUPABASE_ANON_KEY: 'eyJ...'   // anon public — مخصص للمتصفح
```

مفتاح `anon` عام عمداً. الجداول غير مكشوفة له؛ الدالة تتحقق من الجلسة في كل طلب.

للتطوير المحلي ضد محاكاة الباك اند:

```bash
npm run demo:server    # http://localhost:8787/api
npm run serve          # http://localhost:8080
# ثم افتح: http://localhost:8080/?api=http://localhost:8787/api
```

### 2.2 النشر على GitHub Pages

1. الـ workflow `.github/workflows/pages.yml` ينشر `frontend/` من `main`.
2. **Settings → Pages → Source: GitHub Actions**.
3. الرابط: `https://<you>.github.io/branch-orders/`.

---

## الأدوار وسير العمل

| الدور | الصلاحيات |
|---|---|
| `branch_user` | مسودات الطلبات، الإرسال، الإلغاء للمسودات، متابعة طلبات **فرعه فقط**، الاستلام وتسجيل النقص، تغيير كلمة السر |
| `admin` | كل الطلبات وكل الفروع، اعتماد/معالجة/شحن/إلغاء، إعادة فتح الاستلام، إدارة الفروع/المستخدمين/الأصناف/التوافر، التقارير وتصدير CSV |

حالة الطلب: `draft → submitted → approved → processing → sent → received` (+ `partially_received` و `shortage_reported` عند النقص، و `cancelled`).

### قواعد حماية في الخادم
- عزل الفروع على كل قراءة/تعديل.
- لا يمكن تعطيل آخر أدمن نشط (`last_active_admin`).
- كلمات المرور: `sha256$32$salt$hash` — لا تُرجع في أي رد أو CSV.
- الجلسات في جدول `sessions` (`SESSION_HOURS`؛ تعطيل المستخدم يبطلها فوراً).
- الواجهة تحمل فقط رابط الدالة ومفتاح `anon`.

### إعدادات اختيارية (جدول `settings`)

| Key | الافتراضي | الوصف |
|---|---|---|
| `TIMEZONE` | `Africa/Cairo` | منطقة التوقيت |
| `SESSION_HOURS` | `12` | ساعات انتهاء الجلسة |
| `ALLOW_DECIMAL_QTY` | `false` | كميات عشرية |
| `REQUIRE_APPROVAL` | `true` | خطوة الاعتماد (يمكن تجاوزها: `submitted → processing`) |

---

## الاختبارات

```bash
npm test
npm run syntax
```

`tests/shared-suite.mjs` يشغّل نفس الـ API على مخزن ذاكرة (بدون شبكة). `demo:server` نفس المنطق عبر HTTP.

---

## حل المشاكل

| المشكلة | الحل |
|---|---|
| "المنصة غير موصولة" | `API_URL` ما زال فيه `YOUR_PROJECT` أو المفتاح `YOUR_ANON_KEY` |
| 401 من الدالة | انشر بـ `--no-verify-jwt` وتأكد أن `config.toml` فيه `verify_jwt = false` |
| دالة تعمل والجداول فارغة | نفّذ ملف الهجرة في SQL Editor |
| صفحة فارغة بعد الدخول | سجّل الخروج وأعد الدخول؛ تأكد أن لمستخدم الفرع `branch_id` صحيح |
| تغييرات الباك اند لا تظهر | راقب Action `Deploy Supabase` على `main` |

## النسخ الاحتياطي

من لوحة Supabase: **Database → Backups**، أو تصدير CSV من الجداول.
