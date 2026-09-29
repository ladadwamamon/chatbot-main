# دليل النشر — Barbeque Pizza

هذا الدليل لنشر التطبيق على سيرفر VPS خاص باستخدام **Portainer + Docker**.

---

## المتطلبات

- سيرفر لينكس مع Docker + Portainer شغّالين
- 512 MB RAM كحد أدنى (يكفي)
- 1 GB مساحة قرص
- دومين (مثل `example.com`) وصلاحية تعديل DNS
- مفتاح Gemini API فعّال

---

## خطوة 1: تجهيز المتغيرات

قبل النشر، جهّز هذه القيم — رح نستخدمها في Portainer:

```
GEMINI_API_KEY=<مفتاح Gemini الحقيقي>
GEMINI_MODEL=gemini-3.6-flash
ADMIN_PASSWORD=<كلمة مرور قوية جداً — مش admin123!>
ADMIN_SECRET=<سلسلة عشوائية طويلة 40+ حرف>
```

**لتوليد `ADMIN_SECRET` عشوائي:**

على لينكس/ماك:
```bash
openssl rand -hex 32
```

على ويندوز PowerShell:
```powershell
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 40 | %{[char]$_})
```

---

## خطوة 2: رفع الكود إلى السيرفر

### الطريقة الأسهل — عبر Git

على جهازك:
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin git@github.com:you/pizza-bot.git
git push -u origin main
```

على السيرفر:
```bash
cd /opt
git clone git@github.com:you/pizza-bot.git bbq-pizza
cd bbq-pizza
```

### أو نقل مباشر (بدون Git)

من جهازك (PowerShell):
```powershell
cd "C:\Users\mamon\Desktop\chatbot main"
# استبعد .venv و data/*.db
tar -cvf pizza.tar --exclude=.venv --exclude=data/*.db .
scp pizza.tar user@server:/opt/
```

على السيرفر:
```bash
cd /opt
mkdir bbq-pizza && cd bbq-pizza
tar -xvf ../pizza.tar
```

---

## خطوة 3: نشر عبر Portainer (طريقة الـ Stack)

1. افتح Portainer → **Stacks** → **Add stack**
2. **Name:** `bbq-pizza`
3. **Build method:** اختر **Web editor**
4. الصق محتوى `docker-compose.yml` (من مجلد المشروع)
5. **Environment variables** (اسحب لأسفل، أضف واحد بواحد):
   ```
   GEMINI_API_KEY = القيمة
   GEMINI_MODEL = gemini-3.6-flash
   ADMIN_PASSWORD = كلمة-مرورك-القوية
   ADMIN_SECRET = السلسلة-العشوائية
   HOST_PORT = 8182
   ```
6. **Enable access control** (اختياري لكن موصى به)
7. اضغط **Deploy the stack**

Portainer رح:
- يبني الصورة من الـ Dockerfile
- ينشئ الحاويات
- ينشئ Volumes: `bbq-pizza_bbq_data` و `bbq-pizza_bbq_images`
- يشغّل التطبيق تلقائياً

**تحقق من التشغيل:**
- افتح `http://<ip-السيرفر>:8182` → لازم يفتح الموقع
- `http://<ip-السيرفر>:8182/health` → لازم يرد `{"status":"ok"}`

---

## خطوة 4: نشر عبر Portainer (طريقة الـ Git repository)

أسهل للتحديث لاحقاً:

1. **Stacks** → **Add stack**
2. **Build method:** **Repository**
3. **Repository URL:** رابط Git repo
4. **Compose path:** `docker-compose.yml`
5. أضف Environment variables كما فوق
6. **Deploy**

للتحديث لاحقاً: Stack → **Pull and redeploy**.

---

## خطوة 5: ربط الدومين

عندك دومين `example.com` وبدك سب دومين مثل `menu.example.com`:

### أ) لو عندك Nginx / Caddy / Traefik على السيرفر

أضف موقع جديد يتحدث لـ `http://127.0.0.1:8000`.

**مثال Nginx:**

```nginx
server {
    listen 80;
    server_name menu.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name menu.example.com;

    ssl_certificate     /etc/letsencrypt/live/menu.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/menu.example.com/privkey.pem;

    # Static + API
    location / {
        proxy_pass http://127.0.0.1:8182;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 90s;
        client_max_body_size 20M;
    }
}
```

**تفعيل شهادة SSL مجانية:**
```bash
sudo certbot --nginx -d menu.example.com
```

### ب) لو ما عندك reverse proxy

استخدم **Nginx Proxy Manager** (تلاقيه Stack جاهز في Portainer). واجهة ويب بسيطة:
- Add Proxy Host → `menu.example.com` → forward to `bbq-pizza:8000`
- SSL tab → طلب شهادة Let's Encrypt مجانية

### ج) DNS

من لوحة تحكم الدومين (Cloudflare، GoDaddy، الخ):

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | menu | IP السيرفر | 3600 |

انتظر 5–30 دقيقة حتى تنتشر DNS، ثم افتح `https://menu.example.com`.

---

## خطوة 6: تحقق من الأمان

بعد أول تسجيل دخول لـ `/admin`:

- ✅ غيّرت `ADMIN_PASSWORD` من `admin123` إلى قوي؟
- ✅ عيّنت `ADMIN_SECRET` بسلسلة عشوائية طويلة؟
- ✅ `.env` مش مرفوع على Git؟
- ✅ HTTPS مفعّل؟ (كل الطلبات على `https://` وليس `http://`)
- ✅ من الإعدادات، حدّث معلومات المطعم؟

---

## نسخ احتياطية

الملفات المهمة داخل volumes:
- `bbq_data` — قاعدة البيانات (المنيو، الطلبات، المحادثات، الأخطاء)
- `bbq_images` — الصور المرفوعة من الإدارة

**نسخة احتياطية يدوية:**

```bash
# على السيرفر
docker run --rm -v bbq-pizza_bbq_data:/data -v $(pwd):/backup alpine \
  tar czf /backup/bbq-data-$(date +%F).tar.gz -C /data .

docker run --rm -v bbq-pizza_bbq_images:/data -v $(pwd):/backup alpine \
  tar czf /backup/bbq-images-$(date +%F).tar.gz -C /data .
```

**استعادة:**
```bash
docker run --rm -v bbq-pizza_bbq_data:/data -v $(pwd):/backup alpine \
  tar xzf /backup/bbq-data-2026-08-25.tar.gz -C /data
```

يفضّل جدولة النسخ الاحتياطية أسبوعياً في cron.

---

## استكشاف الأخطاء

**التطبيق ما بيفتح:**
- Portainer → Containers → `bbq-pizza` → Logs
- تأكد من متغيرات البيئة (خاصة `GEMINI_API_KEY`)
- تأكد من أن المنفذ المختار (`HOST_PORT`) مش مستخدم بشي ثاني — جرّب `netstat -tlnp | grep :8182`

**الشات ما بيرد:**
- تحقق من `GEMINI_API_KEY` صحيح
- افتح `/admin` → Errors → شوف تفاصيل الخطأ
- الإعدادات → الشات بوت → مُفعّل

**نسيت كلمة مرور الإدارة:**
- عدّل `ADMIN_PASSWORD` في Portainer → Stack → Update
- ما تحتاج تحذف الـ volumes

**بدك تصفر التطبيق كلياً (تحذيرـ حذف كل البيانات):**
- Stacks → bbq-pizza → Remove (اختر remove volumes)
- ثم Deploy جديد

---

## تحديث التطبيق

عبر Git repository:
1. عدّل الكود محلياً → push للـ repo
2. Portainer → Stacks → bbq-pizza → **Pull and redeploy**

عبر Web editor:
1. Portainer → Stacks → bbq-pizza → Editor
2. عدّل الـ compose أو أعد بناء الصورة
3. **Update the stack**

البيانات في الـ volumes تبقى محفوظة عبر التحديثات.

---

## أسطول المنصة (Manager مركزي + VPS لكل زبون)

المنصة (`manager.ourcompany.com`) سجل ومراقبة. كل مطعم يعيش على VPS ودومين لحاله. النسخة **تبعث** للمنصة، المنصة ما تعتمد على طرق الموقع كمصدر حقيقة للاتصال.

### على سيرفر المنصة (الـ hub)

في `.env` / Portainer:

```
HUB_PUBLIC_URL=https://manager.ourcompany.com
MANAGER_PASSWORD=<كلمة مرور لوحة المنصة>
MANAGER_SECRET=<سلسلة عشوائية>
```

**لا تضبط `HUB_URL` على الـ hub** — هذا المتغير للنسخ البعيدة فقط، وإلا السيرفر يحاول يبعث لنفسه.

بعد الرفع: افتح `/manager` → أضف مطعم → دومين الزبون → انسخ الأمر الواحد.

### على VPS الزبون

1. وصّل الدومين (Cloudflare DNS + SSL قدام الـ VPS شيء طبيعي).
2. الصق الأمر الواحد من بطاقة المطعم في اللوحة (يثبت Docker إن لزم ويرفع الحاوية).
3. ضع صورة `bbq-pizza:latest` على السيرفر مسبقاً (`docker load < bbq-pizza.tar` أو بناء المشروع).
4. خلال ~30 ثانية البطاقة تصير **متصل** من نبضة الوكيل.

متغيرات النسخة البعيدة:

| المتغير | المعنى |
|---------|--------|
| `PUBLIC_URL` | دومين المطعم (QR والموقع) |
| `HUB_URL` | رابط لوحة المنصة |
| `MANAGER_TOKEN` | يطابق السجل في `/manager` |
| `SKIP_SEED=1` | منيو فارغ بدون أصناف القالب |

**متصل** = آخر نبضة أقل من دقيقتين. **تأخر** حتى 10 دقائق. الفحص عبر `public_url` زر اختياري، مش شرط الاتصال.

إذا Cloudflare أو الشبكة منعت المنصة من الوصول للأصل: دفع الهوية وإفراغ المنيو يدخلان طابور `agent_commands` ويتنفّذان عند النبضة الجاية.

---

## حدود الأداء المتوقعة

للسيرفر بمواصفات دنيا (1 CPU / 512 MB RAM):

- **موقع + منيو:** يخدم مئات الزوار/ساعة بسهولة
- **طلبات مع تخزين:** 500+ طلب/يوم بدون مشكلة
- **شات بوت:** محدود بكوتا Gemini، وليس بالسيرفر
- **صور:** تُخدم مباشرة من القرص، خفيف

**إذا زاد الحمل:**
- زد RAM إلى 1 GB
- ضع cache/CDN أمام الصور
- انقل SQLite إلى Postgres

---

## الحد الأدنى موارد VPS

| المورد | الحد الأدنى | مريح |
|--------|-------------|------|
| CPU | 1 vCPU | 2 vCPU |
| RAM | 512 MB | 1 GB |
| قرص | 5 GB | 10 GB |
| Bandwidth | 100 GB/شهر | لا حدود |

سيرفرات مناسبة (~5$/شهر):
- Hetzner CX11 (2 vCPU, 2 GB)
- Contabo VPS S
- DigitalOcean $6 droplet

---

## ملاحظة أمان أخيرة

كل مطعم على VPS وداتا منفصلة. المنصة سجل وتحكم عبر نبضات صادرة من الزبون. لا تضع مواقع الزبائن على سيرفر المنصة، ولا تعتمد على Vercel لهذا الـ stack (FastAPI + SQLite + Docker).

أتمتة شراء السيرفر وربط DNS من API المزوّد مرحلة لاحقة — بعد ما القلب (heartbeat + الأمر الواحد) يشتغل.
