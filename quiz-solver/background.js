// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
    API_KEY: "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",
    MODEL: "llama-3.3-70b-versatile",
    API_URL: "https://api.groq.com/openai/v1/chat/completions",
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
    if (request.action === "SOLVE_QUIZ") {
        solveQuiz(request.data, sender.tab?.id);
        return true; // Keep channel open for async response
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
function buildPrompt(question, options) {
    return `You are an AWS expert helping solve quiz questions from AWS Academy.Search multiple sources ,compare ans and then give corret ans. The questions will be from aws academy module quiz for AWS Academy Cloud Architecting [145918]

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
}

// ============================================
// MAIN SOLVER FUNCTION
// ============================================
async function solveQuiz(data, tabId) {
    try {
        const { question, options } = data;

        if (!question || !options || options.length === 0) {
            throw new Error("Invalid quiz data: missing question or options");
        }

        // Check rate limit
        checkRateLimit();

        // Update status
        sendStatus("AI is analyzing the question...");

        // Call Groq API
        const response = await fetch(CONFIG.API_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${CONFIG.API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                messages: [
                    {
                        role: "system",
                        content: "You are an AWS expert. Provide accurate, concise answers based on AWS documentation and best practices."
                    },
                    {
                        role: "user",
                        content: buildPrompt(question, options)
                    }
                ],
                model: CONFIG.MODEL,
                temperature: 0.3, // Low for consistent answers
                max_tokens: 500,
                top_p: 0.9
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(
                errorData.error?.message || `API Error: ${response.status} ${response.statusText}`
            );
        }

        const result = await response.json();
        const rawAnswer = result.choices?.[0]?.message?.content?.trim();

        if (!rawAnswer) {
            throw new Error("Empty response from AI model");
        }

        // Find best matching option(s)
        const { answers, confidence } = findBestMatch(rawAnswer, options);

        // Send result to sidebar
        chrome.runtime.sendMessage({
            action: "SHOW_RESULT",
            data: {
                question,
                options,
                answer: answers.join(" | "),
                answers: answers, // Array for multi-select
                confidence: Math.round(confidence * 100),
                model: CONFIG.MODEL,
                usage: result.usage
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
