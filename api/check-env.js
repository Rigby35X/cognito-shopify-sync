export default async function handler(req, res) {
  const {
    SHOPIFY_STORE_DOMAIN,
    SHOPIFY_ADMIN_API_ACCESS_TOKEN,
    SHOPIFY_API_VERSION
  } = process.env;

  return res.status(200).json({
    hasStoreDomain: !!SHOPIFY_STORE_DOMAIN,
    storeDomainLength: SHOPIFY_STORE_DOMAIN?.length || 0,
    storeDomainPreview: SHOPIFY_STORE_DOMAIN ?
      `${SHOPIFY_STORE_DOMAIN.substring(0, 3)}...${SHOPIFY_STORE_DOMAIN.substring(SHOPIFY_STORE_DOMAIN.length - 15)}` :
      null,
    hasAccessToken: !!SHOPIFY_ADMIN_API_ACCESS_TOKEN,
    tokenLength: SHOPIFY_ADMIN_API_ACCESS_TOKEN?.length || 0,
    tokenStartsWith: SHOPIFY_ADMIN_API_ACCESS_TOKEN?.substring(0, 6) || null,
    hasApiVersion: !!SHOPIFY_API_VERSION,
    apiVersion: SHOPIFY_API_VERSION || null,
    constructedUrl: SHOPIFY_STORE_DOMAIN && SHOPIFY_API_VERSION ?
      `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products.json` :
      null
  });
}
