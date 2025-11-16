export default async function handler(req, res) {
  try {
    console.log("Received request:", req.method);

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const payload = req.body;
    console.log("Payload received:", JSON.stringify(payload, null, 2));

    const dog = mapCognitoToDog(payload);
    console.log("Mapped dog data:", JSON.stringify(dog, null, 2));

    if (!dog.entryId) {
      console.error("Missing entry ID in payload");
      return res.status(400).json({
        error: "Missing Cognito entry ID",
        receivedPayload: payload
      });
    }

    const {
      SHOPIFY_STORE_DOMAIN,
      SHOPIFY_ADMIN_API_ACCESS_TOKEN,
      SHOPIFY_API_VERSION
    } = process.env;

    if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_API_ACCESS_TOKEN || !SHOPIFY_API_VERSION) {
      console.error("Missing Shopify environment variables");
      return res.status(500).json({
        error: "Missing Shopify environment variables",
        hasStoreDomain: !!SHOPIFY_STORE_DOMAIN,
        hasAccessToken: !!SHOPIFY_ADMIN_API_ACCESS_TOKEN,
        hasApiVersion: !!SHOPIFY_API_VERSION
      });
    }

    const shopifyBase = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}`;
    const handle = `dog-${dog.entryId}`.toLowerCase();
    console.log("Looking for product with handle:", handle);

    const existingProduct = await findProductByHandle(
      shopifyBase,
      SHOPIFY_ADMIN_API_ACCESS_TOKEN,
      handle
    );

    const productPayload = buildShopifyProductPayload(dog, handle);

    let result;

    if (existingProduct) {
      console.log("Updating existing product:", existingProduct.id);
      const updateResp = await fetch(`${shopifyBase}/products/${existingProduct.id}.json`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_ACCESS_TOKEN
        },
        body: JSON.stringify({ product: { ...productPayload, id: existingProduct.id } })
      });

      if (!updateResp.ok) {
        const text = await updateResp.text();
        console.error("Shopify update failed:", text);
        return res.status(502).json({
          error: "Failed to update product",
          details: text,
          productId: existingProduct.id
        });
      }

      result = await updateResp.json();
      console.log("Product updated successfully:", existingProduct.id);
    } else {
      console.log("Creating new product with handle:", handle);
      const createResp = await fetch(`${shopifyBase}/products.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_ACCESS_TOKEN
        },
        body: JSON.stringify({ product: productPayload })
      });

      if (!createResp.ok) {
        const text = await createResp.text();
        console.error("Shopify create failed:", text);
        return res.status(502).json({
          error: "Failed to create product",
          details: text,
          handle: handle
        });
      }

      result = await createResp.json();
      console.log("Product created successfully:", result.product?.id);
    }

    return res.status(200).json({
      success: true,
      action: existingProduct ? "updated" : "created",
      product: result.product || result
    });

  } catch (err) {
    console.error("Unhandled error:", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err.message || String(err),
      stack: process.env.NODE_ENV === "development" ? err.stack : undefined
    });
  }
}

function mapCognitoToDog(payload) {
  const entryId = payload.EntryId || payload.id || payload.Id;

  const name = payload["Name"] || payload["Dog Name"];
  const story = payload["My Story"];
  const litter = payload["Litter"];
  const birthday = payload["Birthday"];
  const breed = payload["Breed"];
  const gender = payload["Gender"];
  const sizeWhenGrown = payload["Size when Grown"];
  const availability = normalizeAvailability(payload["Availability"]);
  const imageUrls = Array.isArray(payload["Pictures"]) ? payload["Pictures"] : [];

  return {
    entryId,
    name,
    story,
    litter,
    birthday,
    breed,
    gender,
    sizeWhenGrown,
    availability,
    imageUrls
  };
}

function normalizeAvailability(value) {
  if (!value) return "Available: Now";
  const v = String(value).toLowerCase();
  if (v.includes("nursery") || v.includes("soon")) return "Available Soon: Nursery";
  if (v.includes("adopted")) return "Adopted";
  return "Available: Now";
}

async function findProductByHandle(baseUrl, accessToken, handle) {
  const url = `${baseUrl}/products.json?handle=${encodeURIComponent(handle)}`;

  try {
    const resp = await fetch(url, {
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json"
      }
    });

    if (!resp.ok) {
      console.error("Failed to search for product:", resp.status, resp.statusText);
      return null;
    }

    const data = await resp.json();
    if (data.products?.length > 0) {
      console.log("Found existing product:", data.products[0].id);
      return data.products[0];
    }
    console.log("No existing product found");
    return null;
  } catch (err) {
    console.error("Error searching for product:", err);
    return null;
  }
}

function buildShopifyProductPayload(dog, handle) {
  const tags = buildTags(dog);
  const body_html = `
    <h2>My Story</h2>
    <p>${dog.story || "No story available yet."}</p>
    ${dog.birthday ? `<p><strong>Birthday:</strong> ${dog.birthday}</p>` : ""}
    ${dog.sizeWhenGrown ? `<p><strong>Size when Grown:</strong> ${dog.sizeWhenGrown}</p>` : ""}
  `.trim();

  const images = dog.imageUrls?.length > 0
    ? dog.imageUrls.map((url) => ({ src: url }))
    : [];

  return {
    title: dog.name || `Dog ${dog.entryId}`,
    body_html,
    handle,
    tags: tags.join(", "),
    images,
    status: "active",
    product_type: "Dog"
  };
}

function buildTags(dog) {
  const tags = [];
  if (dog.availability) tags.push(dog.availability);
  if (dog.litter) tags.push(`Litter: ${dog.litter}`);
  if (dog.breed) tags.push(`Breed: ${dog.breed}`);
  if (dog.gender) tags.push(`Gender: ${dog.gender}`);
  return tags;
}
