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

    const handle = `dog-${dog.entryId}`;
    console.log("=== PERMANENT HANDLE ===");
    console.log("Cognito ID:", dog.entryId);
    console.log("Shopify Handle:", handle);

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

      const updateResp = await fetch(`${shopifyBase}/products/${existingProduct.id}.json`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_ACCESS_TOKEN
        },
        body: JSON.stringify({
          product: {
            id: existingProduct.id,
            handle: handle,
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

/**
 * Converts plain text "My Story" content into HTML.
 * Rules:
 *   - Lines ending with ":" are wrapped in <strong>
 *   - Lines starting with "•" or "-" become <ul><li> list items
 *   - Blank lines become paragraph breaks
 *   - All other lines become <p> tags
 */
function convertStoryToHtml(text) {
  if (!text) return '';

  const lines = text.split('\n');
  let html = '';
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Blank line — close any open list, add paragraph spacing
    if (line === '') {
      if (inList) {
        html += '</ul>\n';
        inList = false;
      }
      continue;
    }

    // Bullet point line
    if (line.startsWith('•') || line.startsWith('-')) {
      if (!inList) {
        html += '<ul>\n';
        inList = true;
      }
      const bulletText = line.replace(/^[•\-]\s*/, '');
      html += `  <li>${bulletText}</li>\n`;
      continue;
    }

    // Close list if we hit a non-bullet line
    if (inList) {
      html += '</ul>\n';
      inList = false;
    }

    // Bold heading — line ends with ":"
    if (line.endsWith(':')) {
      html += `<p><strong>${line}</strong></p>\n`;
      continue;
    }

    // Regular paragraph
    html += `<p>${line}</p>\n`;
  }

  // Close any unclosed list
  if (inList) {
    html += '</ul>\n';
  }

  return html.trim();
}

function mapCognitoToDog(payload) {
  const entryId = payload.Id;

  console.log("=== PERMANENT ID EXTRACTION ===");
  console.log("Cognito ID:", entryId);

  if (!entryId) {
    console.error("CRITICAL: No Id field found in payload!");
    console.error("Available fields:", Object.keys(payload));
  }

  const name = payload["DogName"] || payload["Name"] || payload["Dog Name"];
  const story = payload["MyStory"] || payload["My Story"];
  const litter = payload["LitterName"] || payload["Litter"];
  const birthday = payload["PupBirthday"] || payload["Birthday"];
  const breed = payload["Breed"];
  const gender = payload["Gender"];
  const sizeWhenGrown = payload["EstimatedSizeWhenGrown"] || payload["Size when Grown"];
  const availability = normalizeAvailability(payload["Code"] || payload["Availability"]);

  const imageUrls = [];

  const photoFields = [
    payload["MainPhoto"],
    payload["AdditionalPhoto1"],
    payload["AdditionalPhoto2"],
    payload["AdditionalPhoto3"],
    payload["AdditionalPhoto4"]
  ];

  photoFields.forEach(photoArray => {
    if (Array.isArray(photoArray) && photoArray.length > 0) {
      photoArray.forEach(photo => {
        if (photo && photo.File) {
          imageUrls.push(photo.File);
        } else if (photo && photo.Id) {
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
  if (v.includes("nursery") || v.includes("soon")) return "Available Soon: Nursery";
  if (v.includes("adopted")) return "Adopted";
  if (v.includes("available") && v.includes("now")) return "Available: Now";
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

  let body_html = '';

  // Convert My Story plain text to formatted HTML
  if (dog.story) {
    body_html += convertStoryToHtml(dog.story) + '\n\n';
  }

  // Structured fields with bold labels
  if (dog.litter) {
    body_html += `<p><b>LITTER:</b><br>${dog.litter}</p>\n`;
  }
  if (dog.birthday) {
    body_html += `<p><b>BIRTHDAY:</b><br>${dog.birthday}</p>\n`;
  }
  if (dog.breed) {
    body_html += `<p><b>BREED:</b><br>${dog.breed}</p>\n`;
  }
  if (dog.gender) {
    body_html += `<p><b>GENDER:</b><br>${dog.gender}</p>\n`;
  }
  if (dog.sizeWhenGrown) {
    body_html += `<p><b>SIZE WHEN GROWN:</b><br>${dog.sizeWhenGrown}</p>\n`;
  }
  if (dog.availability) {
    body_html += `<p><b>AVAILABILITY:</b><br>${dog.availability}</p>\n`;
  }

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
