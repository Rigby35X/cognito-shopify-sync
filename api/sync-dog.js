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

    // CRITICAL: Create permanent handle from Cognito ID
    // Format: dog-24-108 (never changes, even if dog name changes)
    const handle = `dog-${dog.entryId}`;
    console.log("=== PERMANENT HANDLE ===");
    console.log("Cognito ID:", dog.entryId);
    console.log("Shopify Handle:", handle);
    console.log("This handle will NEVER change for this dog");

    // Search for existing product by handle ONLY (not by name/title)
    const existingProduct = await findProductByHandle(
      shopifyBase,
      SHOPIFY_ADMIN_API_ACCESS_TOKEN,
      handle
    );

    const productPayload = buildShopifyProductPayload(dog, handle);

    let result;

    if (existingProduct) {
      console.log("=== UPDATING EXISTING PRODUCT ===");
      console.log("Product ID:", existingProduct.id);
      console.log("Current title:", existingProduct.title);
      console.log("New title:", productPayload.title);

      // Update existing product - preserve ID and handle
      const updateResp = await fetch(`${shopifyBase}/products/${existingProduct.id}.json`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_ACCESS_TOKEN
        },
        body: JSON.stringify({
          product: {
            id: existingProduct.id,
            handle: handle, // Ensure handle stays the same
            ...productPayload
          }
        })
      });

      if (!updateResp.ok) {
        const text = await updateResp.text();
        console.error("Shopify update failed:", text);
        return res.status(502).json({
          error: "Failed to update product",
          details: text,
          productId: existingProduct.id,
          handle: handle
        });
      }

      result = await updateResp.json();
      console.log("✅ Product updated successfully:", existingProduct.id);
    } else {
      console.log("=== CREATING NEW PRODUCT ===");
      console.log("Handle:", handle);
      console.log("Title:", productPayload.title);

      // Create new product with permanent handle
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
      console.log("✅ Product created successfully");
      console.log("Product ID:", result.product?.id);
      console.log("Handle:", result.product?.handle);
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
  // CRITICAL: Extract permanent ID from payload.Id
  // Format: "FormId-EntryNumber" (e.g., "24-108")
  // This is the ONLY permanent identifier - never changes
  const entryId = payload.Id;

  console.log("=== PERMANENT ID EXTRACTION ===");
  console.log("Cognito ID:", entryId);
  console.log("Type:", typeof entryId);

  if (!entryId) {
    console.error("CRITICAL: No Id field found in payload!");
    console.error("Available fields:", Object.keys(payload));
  }

  // Match actual Cognito field names
  const name = payload["DogName"] || payload["Name"] || payload["Dog Name"];
  const story = payload["MyStory"] || payload["My Story"];
  const litter = payload["LitterName"] || payload["Litter"];
  const birthday = payload["PupBirthday"] || payload["Birthday"];
  const breed = payload["Breed"];
  const gender = payload["Gender"];
  const sizeWhenGrown = payload["EstimatedSizeWhenGrown"] || payload["Size when Grown"];
  const availability = normalizeAvailability(payload["Code"] || payload["Availability"]);

  // Extract image URLs from Cognito photo objects
  const imageUrls = [];

  // Get all photo fields
  const photoFields = [
    payload["MainPhoto"],
    payload["AdditionalPhoto1"],
    payload["AdditionalPhoto2"],
    payload["AdditionalPhoto3"],
    payload["AdditionalPhoto4"]
  ];

  // Extract image URLs - try both File URL (with token) and file endpoint
  photoFields.forEach(photoArray => {
    if (Array.isArray(photoArray) && photoArray.length > 0) {
      photoArray.forEach(photo => {
        if (photo && photo.File) {
          // Use the File URL provided by Cognito (includes auth token)
          imageUrls.push(photo.File);
        } else if (photo && photo.Id) {
          // Fallback to file download endpoint
          imageUrls.push(`https://www.cognitoforms.com/file/${photo.Id}`);
        }
      });
    }
  });

  console.log("Extracted image URLs:", imageUrls);

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

  // Only normalize if it matches known patterns
  if (v.includes("nursery") || v.includes("soon")) return "Available Soon: Nursery";
  if (v.includes("adopted")) return "Adopted";
  if (v.includes("available") && v.includes("now")) return "Available: Now";

  // Otherwise, use the exact value from Cognito
  return String(value);
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

  // Build description: Story first, then structured fields with bold labels
  let body_html = '';

  // Story comes first as a regular paragraph (no heading)
  if (dog.story) {
    body_html += `<p>${dog.story}</p>\n\n`;
  }

  // Add structured fields with bold labels and line breaks
  if (dog.litter) {
    body_html += `<b>LITTER:</b><br>\n${dog.litter}<br><br>\n\n`;
  }

  if (dog.birthday) {
    body_html += `<b>BIRTHDAY:</b><br>\n${dog.birthday}<br><br>\n\n`;
  }

  if (dog.breed) {
    body_html += `<b>BREED:</b><br>\n${dog.breed}<br><br>\n\n`;
  }

  if (dog.gender) {
    body_html += `<b>GENDER:</b><br>\n${dog.gender}<br><br>\n\n`;
  }

  if (dog.sizeWhenGrown) {
    body_html += `<b>SIZE WHEN GROWN:</b><br>\n${dog.sizeWhenGrown}<br><br>\n\n`;
  }

  if (dog.availability) {
    body_html += `<b>AVAILABILITY:</b><br>\n${dog.availability}<br><br>\n\n`;
  }

  // Fallback if no content
  if (!body_html.trim()) {
    body_html = '<p>No information available.</p>';
  }

  const images = dog.imageUrls?.length > 0
    ? dog.imageUrls.map((url) => ({ src: url }))
    : [];

  return {
    title: dog.name || `Dog ${dog.entryId}`,
    body_html: body_html.trim(),
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
