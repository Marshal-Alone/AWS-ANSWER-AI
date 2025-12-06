// ============================================
// CONFIGURATION
// ============================================
const GEMINI_API = 'AIzaSyDa1p0tet4GWKH0P8-qFMfojOxmChQ27Ms';
const GROQ_API = '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'
const CONFIG = {
    PROVIDERS: {
        GEMINI_25_FLASH: {
            name: "Google Gemini 2.5 Flash",
            apiKey: GEMINI_API,
            model: "gemini-2.5-flash",
            apiUrl: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
            temperature: 0.1,
            maxTokens: 8192
        },
        GEMINI_25_PRO: {
            name: "Google Gemini 2.5 Pro",
            apiKey: GEMINI_API,
            model: "gemini-2.5-pro",
            apiUrl: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent",
            temperature: 0.1,
            maxTokens: 8192
        },
        GEMINI_PRO_LATEST: {
            name: "Gemini Pro Latest",
            apiKey: GEMINI_API,
            model: "gemini-pro-latest",
            apiUrl: "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-latest:generateContent",
            temperature: 0.1,
            maxTokens: 8192
        },
        GROQ: {
            name: "Groq Llama 3.3 70B",
            apiKey: GROQ_API,
            model: "llama-3.3-70b-versatile",
            apiUrl: "https://api.groq.com/openai/v1/chat/completions",
            temperature: 0.1,
            maxTokens: 500
        }
    },
    RATE_LIMIT: {
        maxRequests: 30,
        perMinutes: 1,
        requests: []
    }
};

// ============================================
// INITIALIZATION
// ============================================
chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error("Side panel setup error:", error));

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('📩 Background.js received message:', request.action);
    if (request.action === "SOLVE_QUIZ") {
        console.log('🎯 Starting quiz solve with data:', request.data);
        solveQuiz(request.data, sender.tab?.id);
        return true; // Keep channel open for async response
    } else if (request.action === "ANALYZE_HTML") {
        console.log('🔍 Analyzing HTML for strategy generation');
        analyzeQuizStructure(request.html, request.hostname, sender.tab?.id);
        return true;
    }
});

// ============================================
// RATE LIMITING
// ============================================
function checkRateLimit() {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Clean old requests
    CONFIG.RATE_LIMIT.requests = CONFIG.RATE_LIMIT.requests.filter(
        (timestamp) => timestamp > oneMinuteAgo
    );

    // Check if limit exceeded
    if (CONFIG.RATE_LIMIT.requests.length >= CONFIG.RATE_LIMIT.maxRequests) {
        const oldestRequest = CONFIG.RATE_LIMIT.requests[0];
        const waitTime = Math.ceil((oldestRequest + 60000 - now) / 1000);
        throw new Error(`Rate limit exceeded. Wait ${waitTime} seconds.`);
    }

    // Add current request
    CONFIG.RATE_LIMIT.requests.push(now);
}

// ============================================
// ANSWER MATCHING ALGORITHM
// ============================================
function findBestMatch(aiAnswer, options) {
    // Handle multiple answers separated by " | "
    const answers = aiAnswer.split(" | ").map(a => a.trim());
    const matched = [];
    let confidence = 0.85;

    for (const answer of answers) {
        // Remove numbering (e.g., "1. ", "A) ")
        const cleanAnswer = answer.replace(/^[\d]+[\.\)]\s*|^[A-Z][\.\)]\s*/i, "").trim();

        let bestOption = null;
        let highestScore = 0;

        for (const opt of options) {
            const score = calculateSimilarity(cleanAnswer, opt);

            if (score > highestScore) {
                highestScore = score;
                bestOption = opt;
            }
        }

        // Only include if similarity is above threshold
        if (highestScore > 0.6) {
            matched.push(bestOption);
            if (highestScore > 0.9) confidence = 0.95; // High confidence
        }
    }

    return {
        answers: matched.length > 0 ? matched : [aiAnswer], // Fallback to original
        confidence: matched.length > 0 ? confidence : 0.7
    };
}

// Calculate similarity score between two strings
function calculateSimilarity(str1, str2) {
    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();

    // Exact match
    if (s1 === s2) return 1.0;

    // One contains the other
    if (s1.includes(s2) || s2.includes(s1)) return 0.95;

    // Levenshtein distance (simplified)
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;

    if (longer.length === 0) return 1.0;

    const editDistance = levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
}

function levenshteinDistance(str1, str2) {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }

    return matrix[str2.length][str1.length];
}

// ============================================
// PROMPT ENGINEERING
// ============================================
function buildPrompt(question, options, mode = 'AWS') {
    if (mode === 'AWS') {
        return `You are an AWS expert helping solve quiz questions from AWS Academy. Search multiple sources, compare answers and then give correct answer. The questions will be from aws academy module quiz for AWS Academy Cloud Architecting [145918]

Question: ${question}

Options:
${options.map((opt, i) => `${i + 1}. ${opt}`).join("\n")}

Instructions:
1. Analyze the question carefully based on AWS best practices and documentation.
2. If ONLY ONE answer is correct, return ONLY that option's exact text.
3. If MULTIPLE answers are correct, return them separated by " | " (space-pipe-space).
4. Return ONLY the option text(s) without numbering, explanations, or extra words.
5. Match the exact wording from the options provided.

Examples:
Single: "Applying cloud characteristics to a solution"
Multiple: "Security and access control | Compliance with laws and regulations"

Answer:`;
    } else if (mode === 'GOOGLE') {
        // Google Developer quiz mode
        return `You are an expert in Google technologies and developer certifications. Analyze the question carefully based on Google Cloud Platform, Android, Web, and other Google technologies documentation and best practices.

Question: ${question}

Options:
${options.map((opt, i) => `${i + 1}. ${opt}`).join("\n")}

Instructions:
1. Analyze the question carefully based on Google's official documentation and best practices.
2. If ONLY ONE answer is correct, return ONLY that option's exact text.
3. If MULTIPLE answers are correct, return them separated by " | " (space-pipe-space).
4. Return ONLY the option text(s) without numbering, explanations, or extra words.
5. Match the exact wording from the options provided.

Examples:
Single: "Use Cloud Functions for serverless execution"
Multiple: "Enable Cloud CDN | Configure load balancing"

Answer:`;
    } else {
        // General mode for non-AWS quizzes
        return `You are an expert quiz solver. Analyze the question carefully and provide the correct answer(s).

Question: ${question}

Options:
${options.map((opt, i) => `${i + 1}. ${opt}`).join("\n")}

Instructions:
1. Analyze the question carefully and determine the correct answer(s).
2. If ONLY ONE answer is correct, return ONLY that option's exact text.
3. If MULTIPLE answers are correct, return them separated by " | " (space-pipe-space).
4. Return ONLY the option text(s) without numbering, explanations, or extra words.
5. Match the exact wording from the options provided.

Examples:
Single: "payload checksum values"
Multiple: "session continuity | packet sequencing"

Answer:`;
    }
}

// ============================================
// MAIN SOLVER FUNCTION
// ============================================
async function solveQuiz(data, tabId) {
    console.log('🚀 solveQuiz function called!');
    console.log('📝 Question:', data?.question);
    console.log('📋 Options:', data?.options);

    try {
        const { question, options } = data;

        if (!question || !options || options.length === 0) {
            throw new Error("Invalid quiz data: missing question or options");
        }

        // Check rate limit
        checkRateLimit();

        // Get selected provider and mode from storage
        const settings = await chrome.storage.local.get(['aiProvider', 'quizMode']);
        const providerKey = settings.aiProvider || 'GEMINI_25_FLASH';
        const quizMode = settings.quizMode || 'AWS';
        const provider = CONFIG.PROVIDERS[providerKey];

        // Update status
        sendStatus(`${provider.name} is analyzing...`);

        let rawAnswer;

        if (providerKey === 'GEMINI_25_FLASH' || providerKey === 'GEMINI_25_PRO' || providerKey === 'GEMINI_PRO_LATEST') {
            // Gemini API call (Flash, Pro, and 2.5 Flash)
            const response = await fetch(`${provider.apiUrl}?key=${provider.apiKey}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: quizMode === 'AWS'
                                ? `You are an AWS expert. Provide accurate, concise answers based on AWS documentation and best practices.\n\n${buildPrompt(question, options, quizMode)}`
                                : quizMode === 'GOOGLE'
                                    ? `You are a Google technologies expert. Provide accurate, concise answers based on Google's official documentation.\n\n${buildPrompt(question, options, quizMode)}`
                                    : `You are an expert quiz solver. Provide accurate, concise answers.\n\n${buildPrompt(question, options, quizMode)}`
                        }]
                    }],
                    generationConfig: {
                        temperature: provider.temperature,
                        maxOutputTokens: provider.maxTokens,
                        topP: 0.95
                    }
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(
                    errorData.error?.message || `Gemini API Error: ${response.status}`
                );
            }

            const result = await response.json();
            rawAnswer = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

            // LOG: Gemini API Response
            console.log('=== GEMINI API RESPONSE ===');
            console.log('Full Response:', JSON.stringify(result, null, 2));
            console.log('Raw Answer:', rawAnswer);
            console.log('===========================');

        } else {
            // Groq API call (OpenAI-compatible)
            const response = await fetch(provider.apiUrl, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${provider.apiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    messages: [
                        {
                            role: "system",
                            content: quizMode === 'AWS'
                                ? "You are an AWS expert. Provide accurate, concise answers based on AWS documentation and best practices."
                                : quizMode === 'GOOGLE'
                                    ? "You are a Google technologies expert. Provide accurate, concise answers based on Google's official documentation."
                                    : "You are an expert quiz solver. Provide accurate, concise answers."
                        },
                        {
                            role: "user",
                            content: buildPrompt(question, options, quizMode)
                        }
                    ],
                    model: provider.model,
                    temperature: provider.temperature,
                    max_tokens: provider.maxTokens,
                    top_p: 0.9
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(
                    errorData.error?.message || `Groq API Error: ${response.status}`
                );
            }

            const result = await response.json();
            rawAnswer = result.choices?.[0]?.message?.content?.trim();

            // LOG: Groq API Response
            console.log('=== GROQ API RESPONSE ===');
            console.log('Full Response:', JSON.stringify(result, null, 2));
            console.log('Raw Answer:', rawAnswer);
            console.log('=========================');
        }

        if (!rawAnswer) {
            throw new Error("Empty response from AI model");
        }

        // Find best matching option(s)
        const { answers, confidence } = findBestMatch(rawAnswer, options);

        // LOG: Matching Results
        console.log('=== ANSWER MATCHING ===');
        console.log('AI Raw Answer:', rawAnswer);
        console.log('Matched Answers:', answers);
        console.log('Confidence:', confidence);
        console.log('Options Available:', options);
        console.log('=======================');

        // Send result to sidebar
        chrome.runtime.sendMessage({
            action: "SHOW_RESULT",
            data: {
                question,
                options,
                answer: answers.join(" | "),
                answers: answers,
                confidence: Math.round(confidence * 100),
                model: provider.name
            }
        });

        // Highlight answers in content script
        if (tabId) {
            chrome.tabs.sendMessage(tabId, {
                action: "HIGHLIGHT_ANSWER",
                answers: answers
            }).catch((err) => {
                console.warn("Could not highlight answer:", err.message);
            });
        }

        sendStatus("Answer ready! ✓");

    } catch (error) {
        console.error("Quiz solving error:", error);

        let userMessage = error.message;

        // Friendly error messages
        if (error.message.includes("rate limit")) {
            userMessage = "⏱️ " + error.message;
        } else if (error.message.includes("API Error: 401")) {
            userMessage = "🔑 Invalid API key. Please check your credentials.";
        } else if (error.message.includes("API Error: 429")) {
            userMessage = "⚠️ Rate limit exceeded. Please wait a minute.";
        } else if (error.message.includes("fetch")) {
            userMessage = "🌐 Network error. Check your internet connection.";
        }

        chrome.runtime.sendMessage({
            action: "ERROR",
            message: userMessage
        });
    }
}

// ============================================
// HELPER FUNCTIONS
// ============================================
function sendStatus(message) {
    chrome.runtime.sendMessage({
        action: "UPDATE_STATUS",
        message: message
    });
}

// ============================================
// STORAGE FOR API KEY (Optional Enhancement)
// ============================================
// Move API key to Chrome storage for security
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.sync.get(["groqApiKey"], (result) => {
        if (!result.groqApiKey) {
            console.warn("⚠️ No API key found. Please set it in extension options.");
        }
    });
});

// ============================================
// AI-POWERED STRATEGY GENERATION
// ============================================

/**
 * Analyze quiz HTML structure using Groq AI and generate extraction strategy
 * @param {string} htmlContent - Cleaned HTML from the quiz container
 * @param {string} hostname - Website hostname for strategy storage
 * @param {number} tabId - Tab ID to send feedback messages
 */
async function analyzeQuizStructure(htmlContent, hostname, tabId) {
    console.log('=== ANALYZING QUIZ STRUCTURE ===');
    console.log('Hostname:', hostname);
    console.log('HTML Length:', htmlContent.length);

    try {
        sendStatus('🔍 AI is analyzing quiz structure...');

        // Hardened system prompt to avoid dynamic CSS classes
        const systemPrompt = `You are an HTML parser. Analyze the provided HTML and return a JSON object with CSS selectors.

CRITICAL RULES:
1. Avoid dynamic/hashed classes (e.g., ".css-1x23", ".sc-abc", ".MuiBox-root.css-xxxxx").
2. Prefer stable attributes in this order: "id", "data-testid", "name", "aria-label", "role", or distinct class names like ".btn-primary", ".question-text".
3. If the Next button is not visible in the HTML, return "null" for that field.
4. For options_selector, ensure it targets ALL option elements (use a selector that matches multiple elements).
5. Return ONLY valid JSON, no markdown, no explanations.

Output JSON Structure:
{
  "question_selector": "selector string",
  "options_selector": "selector string (must target all options)",
  "input_type": "radio" | "checkbox" | "text",
  "submit_next_selector": "selector string or null"
}`;

        const userPrompt = `Analyze this quiz HTML and extract CSS selectors:\n\n${htmlContent}`;

        // Call Groq API
        const response = await fetch(CONFIG.PROVIDERS.GROQ.apiUrl, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${CONFIG.PROVIDERS.GROQ.apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ],
                model: CONFIG.PROVIDERS.GROQ.model,
                temperature: 0.1,
                max_tokens: 1000,
                response_format: { type: "json_object" }
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `Groq API Error: ${response.status}`);
        }

        const result = await response.json();
        const rawAnswer = result.choices?.[0]?.message?.content?.trim();

        console.log('=== GROQ AI RESPONSE ===');
        console.log('Raw Response:', rawAnswer);

        if (!rawAnswer) {
            throw new Error("Empty response from Groq AI");
        }

        // Parse JSON strategy
        let strategy;
        try {
            strategy = JSON.parse(rawAnswer);
        } catch (parseError) {
            console.error('JSON Parse Error:', parseError);
            throw new Error("AI returned invalid JSON format");
        }

        // Validate strategy structure
        if (!strategy.question_selector || !strategy.options_selector) {
            console.error('Invalid strategy:', strategy);
            throw new Error(`AI strategy incomplete. Missing: ${!strategy.question_selector ? 'question_selector ' : ''}${!strategy.options_selector ? 'options_selector' : ''}`);
        }

        // Set defaults for optional fields
        if (!strategy.input_type) {
            strategy.input_type = 'radio'; // Default to radio
            console.warn('input_type not provided, defaulting to "radio"');
        }

        if (!strategy.submit_next_selector) {
            strategy.submit_next_selector = null; // Explicitly set to null
            console.warn('submit_next_selector not provided, will use fallback detection');
        }

        console.log('✅ Parsed Strategy:', strategy);

        // Store strategy with hostname key
        const strategyKey = `quiz_strategy_${hostname}`;
        await chrome.storage.local.set({ [strategyKey]: strategy });

        console.log(`💾 Strategy saved for ${hostname}`);

        // Send success message to sidebar
        chrome.runtime.sendMessage({
            action: "STRATEGY_SAVED",
            hostname: hostname,
            strategy: strategy
        });

        // Send success message to tab
        if (tabId) {
            chrome.tabs.sendMessage(tabId, {
                action: "STRATEGY_APPLIED",
                success: true
            }).catch(err => console.warn('Could not notify tab:', err));
        }

        sendStatus(`✅ Strategy saved for ${hostname}!`);

    } catch (error) {
        console.error('❌ Strategy generation error:', error);

        let userMessage = error.message;

        // Friendly error messages
        if (error.message.includes("API Error: 401")) {
            userMessage = "🔑 Invalid Groq API key. Please check configuration.";
        } else if (error.message.includes("API Error: 429")) {
            userMessage = "⚠️ Rate limit exceeded. Please wait a minute.";
        } else if (error.message.includes("fetch")) {
            userMessage = "🌐 Network error. Check your internet connection.";
        }

        chrome.runtime.sendMessage({
            action: "ERROR",
            message: `Strategy generation failed: ${userMessage}`
        });

        sendStatus(`❌ Error: ${userMessage}`);
    }
}

