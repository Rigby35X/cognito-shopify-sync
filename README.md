# Cognito → Shopify Sync (Serverless Integration)

This project replaces Zapier with a stable, duplicate-proof integration.

## 🚀 What it does
- Creates NEW Shopify products when a new dog is submitted in Cognito
- UPDATES matching Shopify products when a dog entry changes
- Matches ONLY by permanent Cognito Entry ID
- Prevents duplicates even when dog names change
- Replaces all images with those from Cognito
- Updates availability tags for automated collections

## 🧩 Setup

### 1. Deploy to Vercel
Click:

➡️ https://vercel.com/import/git

Import this repo.

### 2. Add Environment Variables
In Vercel → Project Settings → Environment Variables:

- `SHOPIFY_STORE_DOMAIN` (e.g., `your-store.myshopify.com`)
- `SHOPIFY_ADMIN_API_ACCESS_TOKEN` (from Shopify Admin API)
- `SHOPIFY_API_VERSION` (e.g., `2024-10`)

### 3. Cognito Webhook Setup
Go to Cognito Forms → Form Settings → Submissions → Post JSON Data

POST URL:
```
https://your-vercel-project.vercel.app/api/sync-dog
```

Replace `your-vercel-project` with your actual Vercel project name.

## 🔧 How it Works

1. Cognito Forms sends webhook POST request when a form is submitted or updated
2. The serverless function receives the payload
3. Maps Cognito form fields to dog product data
4. Checks if a product with the same Entry ID already exists in Shopify
5. Creates a new product or updates the existing one
6. Returns success/error response

## 📋 Field Mapping

| Cognito Field | Shopify Usage |
|---------------|---------------|
| Entry ID | Product handle: `dog-{entryId}` |
| Name / Dog Name | Product title |
| My Story | Product description |
| Pictures | Product images |
| Availability | Product tag for collections |
| Breed, Gender, Litter | Product tags |

## 🧪 Testing

### Local Testing

1. Copy `.env.example` to `.env` and fill in your Shopify credentials:
```bash
cp .env.example .env
```

2. Install Vercel CLI if needed:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

4. Send a test request using the sample payload:
```bash
curl -X POST http://localhost:3000/api/sync-dog \
  -H "Content-Type: application/json" \
  -d @test-payload.json
```

Or use any API testing tool like Postman, Insomnia, or Thunder Client.

## 📝 Logs

Check Vercel deployment logs to monitor webhook activity and debug any issues.

## 🔐 Security

- Never commit `.env` files
- Keep Shopify access tokens secure
- Verify webhook source in production if needed
