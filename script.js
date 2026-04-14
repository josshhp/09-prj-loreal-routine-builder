/* Get references to DOM elements */
const categoryFilter = document.getElementById("categoryFilter");
const productSearchInput = document.getElementById("productSearch");
const productsContainer = document.getElementById("productsContainer");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");
const selectedProductsList = document.getElementById("selectedProductsList");
const generateRoutineBtn = document.getElementById("generateRoutine");
const clearSelectedProductsBtn = document.getElementById(
  "clearSelectedProducts",
);
const userInput = document.getElementById("userInput");

/* Keep selected products in memory while the page is open */
const selectedProducts = [];
let generatedRoutineText = "";
let conversationHistory = [];
let chatLoaderElement = null;
const SELECTED_PRODUCTS_STORAGE_KEY = "selectedProducts";

const ROUTINE_SYSTEM_PROMPT =
  "You are a skincare and beauty routine assistant. You only answer questions about the generated routine and related topics such as skincare, haircare, makeup, fragrance, grooming, ingredients, application order, product compatibility, and safety tips. If a question is outside these topics, politely refuse and ask for a beauty-related question.";

const ALLOWED_TOPIC_KEYWORDS = [
  "routine",
  "skin",
  "skincare",
  "hair",
  "haircare",
  "makeup",
  "fragrance",
  "perfume",
  "grooming",
  "cleanser",
  "serum",
  "moisturizer",
  "sunscreen",
  "spf",
  "acne",
  "dry",
  "oily",
  "sensitive",
  "foundation",
  "mascara",
  "shampoo",
  "conditioner",
  "ingredient",
  "beauty",
  "cosmetic",
  "product",
  "products",
  "complement",
  "layer",
  "pair",
  "add",
  "recommend",
  "recommendation",
];

const CONTEXT_REFERENCING_KEYWORDS = [
  "this",
  "that",
  "it",
  "these",
  "those",
  "current",
  "my routine",
  "my products",
];

const FOLLOW_UP_INTENT_KEYWORDS = [
  "complement",
  "pair",
  "layer",
  "add",
  "swap",
  "replace",
  "alternative",
  "recommend",
  "recommendation",
  "better",
  "improve",
  "works with",
  "go with",
];

/* Show initial placeholder until user selects a category */
productsContainer.innerHTML = `
  <div class="placeholder-message">
    Select a category to view products
  </div>
`;

/* Show initial selected-products placeholder */
selectedProductsList.innerHTML = `
  <p class="selected-placeholder">No products selected yet.</p>
`;

/* Load product data from JSON file */
async function loadProducts() {
  const response = await fetch("products.json");
  const data = await response.json();
  return data.products;
}

/* Small helper to add chat bubbles to the chat window */
function appendChatMessage(role, text) {
  const message = document.createElement("div");
  message.className = `chat-message chat-message--${role}`;

  const roleLabel = document.createElement("p");
  roleLabel.className = "chat-role";
  roleLabel.textContent = role === "user" ? "YOU" : "ADVISOR";

  const content = document.createElement("p");
  content.className = "chat-content";
  content.textContent = text;

  message.appendChild(roleLabel);
  message.appendChild(content);
  chatWindow.appendChild(message);

  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function showChatLoader() {
  hideChatLoader();

  const loader = document.createElement("div");
  loader.className = "chat-logo-loader";
  loader.innerHTML = `
    <img src="img/loreal-logo.png" alt="L'Oréal loading" class="chat-loader-logo" />
  `;

  chatWindow.appendChild(loader);
  chatLoaderElement = loader;
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function hideChatLoader() {
  if (chatLoaderElement) {
    chatLoaderElement.remove();
    chatLoaderElement = null;
  }

  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function isAllowedFollowUpQuestion(question) {
  const lowerQuestion = question.toLowerCase();

  const hasDirectBeautyKeyword = ALLOWED_TOPIC_KEYWORDS.some((keyword) =>
    lowerQuestion.includes(keyword),
  );

  if (hasDirectBeautyKeyword) {
    return true;
  }

  /* Allow contextual follow-ups like "what complements this" once a routine exists */
  const hasRoutineContext = Boolean(generatedRoutineText);
  const hasContextReference = CONTEXT_REFERENCING_KEYWORDS.some((keyword) =>
    lowerQuestion.includes(keyword),
  );
  const hasFollowUpIntent = FOLLOW_UP_INTENT_KEYWORDS.some((keyword) =>
    lowerQuestion.includes(keyword),
  );

  return hasRoutineContext && hasContextReference && hasFollowUpIntent;
}

function saveSelectedProductsToStorage() {
  localStorage.setItem(
    SELECTED_PRODUCTS_STORAGE_KEY,
    JSON.stringify(selectedProducts),
  );
}

function loadSelectedProductsFromStorage() {
  const savedProductsJSON = localStorage.getItem(SELECTED_PRODUCTS_STORAGE_KEY);

  if (!savedProductsJSON) {
    return;
  }

  try {
    const savedProducts = JSON.parse(savedProductsJSON);

    if (!Array.isArray(savedProducts)) {
      return;
    }

    savedProducts.forEach((product) => {
      if (product && typeof product.id === "number" && product.name) {
        selectedProducts.push(product);
      }
    });
  } catch {
    localStorage.removeItem(SELECTED_PRODUCTS_STORAGE_KEY);
  }
}

function hasActiveProductFilters() {
  return Boolean(categoryFilter.value || productSearchInput.value.trim());
}

async function applyProductFilters() {
  const products = await loadProducts();
  const selectedCategory = categoryFilter.value;
  const searchTerm = productSearchInput.value.trim().toLowerCase();

  const filteredProducts = products.filter((product) => {
    const matchesCategory =
      !searchTerm &&
      (!selectedCategory || product.category === selectedCategory);

    const matchesSearch =
      !searchTerm ||
      product.name.toLowerCase().includes(searchTerm) ||
      product.brand.toLowerCase().includes(searchTerm) ||
      product.description.toLowerCase().includes(searchTerm) ||
      product.category.toLowerCase().includes(searchTerm);

    return searchTerm ? matchesSearch : matchesCategory;
  });

  displayProducts(filteredProducts);
}

async function refreshVisibleProducts() {
  if (!hasActiveProductFilters()) {
    return;
  }

  await applyProductFilters();
}

async function requestChatCompletion(messages) {
  if (!window.CLOUDFLARE_WORKER_URL) {
    throw new Error(
      "Missing CLOUDFLARE_WORKER_URL. Add your Worker URL in secrets.js.",
    );
  }

  const response = await fetch(window.CLOUDFLARE_WORKER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(window.CLOUDFLARE_WORKER_TOKEN
        ? { Authorization: `Bearer ${window.CLOUDFLARE_WORKER_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMessage =
      errorData?.error?.message || "Unable to get a response right now.";
    throw new Error(errorMessage);
  }

  const data = await response.json();
  const assistantReply =
    data?.choices?.[0]?.message?.content || data?.message || data?.reply;

  if (!assistantReply) {
    throw new Error("No message returned from OpenAI.");
  }

  return assistantReply;
}

/* Build a routine using only selected product JSON and OpenAI */
async function generateRoutineFromSelectedProducts() {
  const selectedProductsData = selectedProducts.map((product) => ({
    name: product.name,
    brand: product.brand,
    category: product.category,
    description: product.description,
  }));

  const messages = [
    {
      role: "system",
      content: ROUTINE_SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: `Create a routine using these selected products:\n${JSON.stringify(selectedProductsData, null, 2)}`,
    },
  ];

  const routine = await requestChatCompletion(messages);

  if (!routine) {
    throw new Error("No routine returned from OpenAI.");
  }

  return routine;
}

/* Create HTML for displaying product cards */
function displayProducts(products) {
  if (products.length === 0) {
    productsContainer.innerHTML = `
      <div class="placeholder-message">
        No products found for this category.
      </div>
    `;
    return;
  }

  productsContainer.innerHTML = products
    .map((product) => {
      const isSelected = selectedProducts.some(
        (selectedProduct) => selectedProduct.id === product.id,
      );

      return `
        <div class="product-card ${isSelected ? "active" : ""}">
          <img src="${product.image}" alt="${product.name}">
          <div class="product-info">
            <h3>${product.name}</h3>
            <p class="product-brand">${product.brand}</p>
            <p class="product-description">${product.description}</p>
            <button class="select-product-btn" data-product-id="${product.id}">
              ${isSelected ? "Unselect" : "Select"}
            </button>
          </div>
        </div>
      `;
    })
    .join("");

  /* Add click listeners after cards are rendered */
  const selectButtons = document.querySelectorAll(".select-product-btn");

  selectButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const productId = Number(button.dataset.productId);
      await toggleProductSelection(productId);
    });
  });
}

/* Add/remove product from selected list */
async function toggleProductSelection(productId) {
  const productIndex = selectedProducts.findIndex(
    (product) => product.id === productId,
  );

  if (productIndex !== -1) {
    selectedProducts.splice(productIndex, 1);
  } else {
    const products = await loadProducts();
    const productToAdd = products.find((product) => product.id === productId);

    if (productToAdd) {
      selectedProducts.push(productToAdd);
    }
  }

  saveSelectedProductsToStorage();
  renderSelectedProducts();
  await refreshVisibleProducts();
}

/* Show selected products below the grid */
function renderSelectedProducts() {
  clearSelectedProductsBtn.disabled = selectedProducts.length === 0;

  if (selectedProducts.length === 0) {
    selectedProductsList.innerHTML = `
      <p class="selected-placeholder">No products selected yet.</p>
    `;
    return;
  }

  selectedProductsList.innerHTML = selectedProducts
    .map(
      (product) => `
        <div class="selected-item">
          <span>${product.name}</span>
          <button class="remove-selected-btn" data-product-id="${product.id}">×</button>
        </div>
      `,
    )
    .join("");

  const removeButtons = document.querySelectorAll(".remove-selected-btn");

  removeButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const productId = Number(button.dataset.productId);
      await toggleProductSelection(productId);
    });
  });
}

clearSelectedProductsBtn.addEventListener("click", async () => {
  selectedProducts.length = 0;
  saveSelectedProductsToStorage();
  renderSelectedProducts();
  await refreshVisibleProducts();
});

/* Filter and display products when category changes */
categoryFilter.addEventListener("change", async (e) => {
  await applyProductFilters();
});

/* Live search filter by product name, brand, category, or description */
productSearchInput.addEventListener("input", async () => {
  await applyProductFilters();
});

/* Generate routine from selected products */
generateRoutineBtn.addEventListener("click", async () => {
  if (selectedProducts.length === 0) {
    chatWindow.innerHTML = "";
    appendChatMessage("assistant", "Please select at least one product first.");
    return;
  }

  generateRoutineBtn.disabled = true;
  chatWindow.innerHTML = "";
  showChatLoader();

  try {
    const selectedProductsData = selectedProducts.map((product) => ({
      name: product.name,
      brand: product.brand,
      category: product.category,
      description: product.description,
    }));

    const routine = await generateRoutineFromSelectedProducts();
    generatedRoutineText = routine;

    /* Reset and seed full conversation context for follow-up questions */
    conversationHistory = [
      { role: "system", content: ROUTINE_SYSTEM_PROMPT },
      {
        role: "system",
        content: `Selected products data:\n${JSON.stringify(selectedProductsData, null, 2)}`,
      },
      {
        role: "assistant",
        content: `Generated routine:\n${routine}`,
      },
    ];

    chatWindow.innerHTML = "";
    hideChatLoader();
    appendChatMessage("assistant", `Generated routine:\n${routine}`);
  } catch (error) {
    hideChatLoader();
    chatWindow.innerHTML = "";
    appendChatMessage("assistant", `Error: ${error.message}`);
  } finally {
    hideChatLoader();
    generateRoutineBtn.disabled = false;
  }
});

/* Follow-up chat after a routine is generated */
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const question = userInput.value.trim();

  if (!question) {
    return;
  }

  if (!generatedRoutineText) {
    chatWindow.innerHTML = "";
    appendChatMessage(
      "assistant",
      "Generate a routine first, then ask follow-up questions.",
    );
    return;
  }

  if (!isAllowedFollowUpQuestion(question)) {
    appendChatMessage(
      "assistant",
      "Please ask a routine or beauty-related question (skincare, haircare, makeup, fragrance, or grooming).",
    );
    userInput.value = "";
    return;
  }

  appendChatMessage("user", question);
  userInput.value = "";

  conversationHistory.push({ role: "user", content: question });
  showChatLoader();

  try {
    const assistantReply = await requestChatCompletion(conversationHistory);
    conversationHistory.push({ role: "assistant", content: assistantReply });
    hideChatLoader();
    appendChatMessage("assistant", assistantReply);
  } catch (error) {
    hideChatLoader();
    appendChatMessage("assistant", `Error: ${error.message}`);
  }
});

/* Restore selected products after a page reload */
loadSelectedProductsFromStorage();
renderSelectedProducts();

/* Show a friendly default advisor message */
appendChatMessage(
  "assistant",
  "Hello! Ask me about skincare, makeup, haircare, or routines.",
);
